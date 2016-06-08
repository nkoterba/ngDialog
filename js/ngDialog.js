/*
 * ngDialog - easy modals and popup windows
 * http://github.com/likeastore/ngDialog
 * (c) 2013-2015 MIT License, https://likeastore.com
 */

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        // CommonJS
        if (typeof angular === 'undefined') {
            factory(require('angular'));
        } else {
            factory(angular);
        }
        module.exports = 'ngDialog';
    } else if (typeof define === 'function' && define.amd) {
        // AMD
        define(['angular'], factory);
    } else {
        // Global Variables
        factory(root.angular);
    }
}(this, function (angular) {
    'use strict';

    var m = angular.module('ngDialog', []);

    var $el                      = angular.element;
    var isDef                    = angular.isDefined;
    var style                    = (document.body || document.documentElement).style;
    var animationEndSupport      = isDef(style.animation) || isDef(style.WebkitAnimation) || isDef(
            style.MozAnimation) || isDef(style.MsAnimation) || isDef(style.OAnimation);
    var animationEndEvent        = 'animationend webkitAnimationEnd mozAnimationEnd MSAnimationEnd oanimationend';
    var focusableElementSelector = 'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, *[tabindex], *[contenteditable]';
    var disabledAnimationClass   = 'ngdialog-disabled-animation';
    var forceElementsReload      = {html: false, body: false};
    var scopes                   = {};
    var openIdStack              = [];
    var openMinimizedIdStack     = [];
    var keydownIsBound           = false;
    var openOnePerName           = false;


    m.provider('ngDialog', function () {
        var defaults = this.defaults = {
            className              : 'ngdialog-theme-default',
            appendClassName        : '',
            disableAnimation       : false,
            plain                  : false,
            showClose              : true,
            closeByDocument        : true,
            closeByEscape          : true,
            closeByNavigation      : false,
            appendTo               : false,
            preCloseCallback       : false,
            overlay                : true,
            cache                  : true,
            trapFocus              : true,
            preserveFocus          : true,
            ariaAuto               : true,
            ariaRole               : null,
            ariaLabelledById       : null,
            ariaLabelledBySelector : null,
            ariaDescribedById      : null,
            ariaDescribedBySelector: null,
            bodyClassName          : 'ngdialog-open',
            width                  : null,
            draggable              : false,
            tooltip                : false,
            mouseEvent             : null,
            showMinimize           : false,
            minimizedTitle         : 'none titled',
            top                    : null,
            bottom                 : null
        };

        this.setForceHtmlReload = function (_useIt) {
            forceElementsReload.html = _useIt || false;
        };

        this.setForceBodyReload = function (_useIt) {
            forceElementsReload.body = _useIt || false;
        };

        this.setDefaults = function (newDefaults) {
            angular.extend(defaults, newDefaults);
        };

        this.setOpenOnePerName = function (isOpenOne) {
            openOnePerName = isOpenOne || false;
        };

        var globalID = 0, dialogsCount = 0, closeByDocumentHandler, defers = {};

        this.$get = ['$document',
            '$templateCache',
            '$compile',
            '$q',
            '$http',
            '$rootScope',
            '$timeout',
            '$window',
            '$controller',
            '$injector',
            function ($document,
                      $templateCache,
                      $compile,
                      $q,
                      $http,
                      $rootScope,
                      $timeout,
                      $window,
                      $controller,
                      $injector) {
                var $elements = [];

                var privateMethods = {
                    onDocumentKeydown: function (event) {
                        if (event.keyCode === 27) {
                            publicMethods.close('$escape');
                        }
                    },

                    activate: function ($dialog) {
                        var options = $dialog.data('$ngDialogOptions');

                        if (options.trapFocus) {
                            $dialog.on('keydown', privateMethods.onTrapFocusKeydown);

                            // Catch rogue changes (eg. after unfocusing everything by clicking
                            // a non-focusable element)
                            $elements.body.on('keydown', privateMethods.onTrapFocusKeydown);
                        }
                    },

                    deactivate: function ($dialog) {
                        $dialog.off('keydown', privateMethods.onTrapFocusKeydown);
                        $elements.body.off('keydown', privateMethods.onTrapFocusKeydown);
                    },

                    deactivateAll: function (els) {
                        angular.forEach(els, function (el) {
                            var $dialog = angular.element(el);
                            privateMethods.deactivate($dialog);
                        });
                    },

                    setBodyPadding: function (width) {
                        var originalBodyPadding = parseInt(($elements.body.css('padding-right') || 0),
                            10);
                        $elements.body.css('padding-right', (originalBodyPadding + width) + 'px');
                        $elements.body.data('ng-dialog-original-padding', originalBodyPadding);
                        $rootScope.$broadcast('ngDialog.setPadding', width);
                    },

                    resetBodyPadding: function () {
                        var originalBodyPadding = $elements.body.data('ng-dialog-original-padding');
                        if (originalBodyPadding) {
                            $elements.body.css('padding-right', originalBodyPadding + 'px');
                        } else {
                            $elements.body.css('padding-right', '');
                        }
                        $rootScope.$broadcast('ngDialog.setPadding', 0);
                    },

                    performCloseDialog: function ($dialog, value) {
                        var options = $dialog.data('$ngDialogOptions');
                        var id      = $dialog.attr('id');
                        var scope   = scopes[id];

                        if (!scope) {
                            // Already closed
                            return;
                        }

                        if (typeof $window.Hammer !== 'undefined') {
                            var hammerTime = scope.hammerTime;
                            hammerTime.off('tap', closeByDocumentHandler);
                            hammerTime.destroy && hammerTime.destroy();
                            delete scope.hammerTime;
                        } else {
                            $dialog.unbind('click');
                        }

                        if (dialogsCount === 1) {
                            $elements.body.unbind('keydown', privateMethods.onDocumentKeydown);
                        }

                        if (!$dialog.hasClass('ngdialog-closing')) {
                            dialogsCount -= 1;
                        }

                        var previousFocus = $dialog.data('$ngDialogPreviousFocus');
                        if (previousFocus && previousFocus.focus) {
                            previousFocus.focus();
                        }

                        var isMinimized = $el(document.getElementById(id + '-minimized')).length === 1;

                        $rootScope.$broadcast('ngDialog.closing', $dialog, value);
                        dialogsCount = dialogsCount < 0 ? 0 : dialogsCount;
                        if (animationEndSupport && !options.disableAnimation && !isMinimized) {
                            scope.$destroy();
                            $dialog.unbind(animationEndEvent).bind(animationEndEvent, function () {
                                privateMethods.closeDialogElement($dialog, value);
                            }).addClass('ngdialog-closing');
                        } else {
                            scope.$destroy();
                            privateMethods.closeDialogElement($dialog, value);
                        }
                        if (defers[id]) {
                            defers[id].resolve({
                                id              : id,
                                value           : value,
                                $dialog         : $dialog,
                                remainingDialogs: dialogsCount
                            });
                            delete defers[id];
                        }
                        if (scopes[id]) {
                            delete scopes[id];
                        }
                        openIdStack.splice(openIdStack.indexOf(id), 1);
                        if (!openIdStack.length) {
                            $elements.body.unbind('keydown', privateMethods.onDocumentKeydown);
                            keydownIsBound = false;
                        }
                    },

                    closeDialogElement: function ($dialog, value) {
                        var options = $dialog.data('$ngDialogOptions');
                        $dialog.remove();
                        if (dialogsCount === 0) {
                            $elements.html.removeClass(options.bodyClassName);
                            $elements.body.removeClass(options.bodyClassName);
                            privateMethods.resetBodyPadding();
                        }
                        $rootScope.$broadcast('ngDialog.closed', $dialog, value);
                    },

                    closeDialog: function ($dialog, value) {
                        var preCloseCallback = $dialog.data('$ngDialogPreCloseCallback');

                        if (preCloseCallback && angular.isFunction(preCloseCallback)) {

                            var preCloseCallbackResult = preCloseCallback.call($dialog, value);

                            if (angular.isObject(preCloseCallbackResult)) {
                                if (preCloseCallbackResult.closePromise) {
                                    preCloseCallbackResult.closePromise.then(function () {
                                        privateMethods.performCloseDialog($dialog, value);
                                    });
                                } else {
                                    preCloseCallbackResult.then(function () {
                                        privateMethods.performCloseDialog($dialog, value);
                                    }, function () {
                                        return;
                                    });
                                }
                            } else if (preCloseCallbackResult !== false) {
                                privateMethods.performCloseDialog($dialog, value);
                            }
                        } else {
                            privateMethods.performCloseDialog($dialog, value);
                        }
                    },

                    onTrapFocusKeydown: function (ev) {
                        var el = angular.element(ev.currentTarget);
                        var $dialog;

                        if (el.hasClass('ngdialog')) {
                            $dialog = el;
                        } else {
                            $dialog = privateMethods.getActiveDialog();

                            if ($dialog === null) {
                                return;
                            }
                        }

                        var isTab    = (ev.keyCode === 9);
                        var backward = (ev.shiftKey === true);

                        if (isTab) {
                            privateMethods.handleTab($dialog, ev, backward);
                        }
                    },

                    handleTab: function ($dialog, ev, backward) {
                        var focusableElements = privateMethods.getFocusableElements($dialog);

                        if (focusableElements.length === 0) {
                            if (document.activeElement) {
                                document.activeElement.blur();
                            }
                            return;
                        }

                        var currentFocus = document.activeElement;
                        var focusIndex   = Array.prototype.indexOf.call(focusableElements,
                            currentFocus);

                        var isFocusIndexUnknown   = (focusIndex === -1);
                        var isFirstElementFocused = (focusIndex === 0);
                        var isLastElementFocused  = (focusIndex === focusableElements.length - 1);

                        var cancelEvent = false;

                        if (backward) {
                            if (isFocusIndexUnknown || isFirstElementFocused) {
                                focusableElements[focusableElements.length - 1].focus();
                                cancelEvent = true;
                            }
                        } else {
                            if (isFocusIndexUnknown || isLastElementFocused) {
                                focusableElements[0].focus();
                                cancelEvent = true;
                            }
                        }

                        if (cancelEvent) {
                            ev.preventDefault();
                            ev.stopPropagation();
                        }
                    },

                    autoFocus: function ($dialog) {
                        var dialogEl = $dialog[0];

                        // Browser's (Chrome 40, Forefix 37, IE 11) don't appear to honor
                        // autofocus on the dialog, but we should
                        var autoFocusEl = dialogEl.querySelector('*[autofocus]');
                        if (autoFocusEl !== null) {
                            autoFocusEl.focus();

                            if (document.activeElement === autoFocusEl) {
                                return;
                            }

                            // Autofocus element might was display: none, so let's continue
                        }

                        var focusableElements = privateMethods.getFocusableElements($dialog);

                        if (focusableElements.length > 0) {
                            focusableElements[0].focus();
                            return;
                        }

                        // We need to focus something for the screen readers to notice the
                        // dialog
                        var contentElements = privateMethods.filterVisibleElements(dialogEl.querySelectorAll(
                            'h1,h2,h3,h4,h5,h6,p,span'));

                        if (contentElements.length > 0) {
                            var contentElement = contentElements[0];
                            $el(contentElement).attr('tabindex', '-1').css('outline', '0');
                            contentElement.focus();
                        }
                    },

                    getFocusableElements: function ($dialog) {
                        var dialogEl = $dialog[0];

                        var rawElements = dialogEl.querySelectorAll(focusableElementSelector);

                        // Ignore untabbable elements, ie. those with tabindex = -1
                        var tabbableElements = privateMethods.filterTabbableElements(rawElements);

                        return privateMethods.filterVisibleElements(tabbableElements);
                    },

                    filterTabbableElements: function (els) {
                        var tabbableFocusableElements = [];

                        for (var i = 0; i < els.length; i++) {
                            var el = els[i];

                            if ($el(el).attr('tabindex') !== '-1') {
                                tabbableFocusableElements.push(el);
                            }
                        }

                        return tabbableFocusableElements;
                    },

                    filterVisibleElements: function (els) {
                        var visibleFocusableElements = [];

                        for (var i = 0; i < els.length; i++) {
                            var el = els[i];

                            if (el.offsetWidth > 0 || el.offsetHeight > 0) {
                                visibleFocusableElements.push(el);
                            }
                        }

                        return visibleFocusableElements;
                    },

                    getActiveDialog: function () {
                        var dialogs = document.querySelectorAll('.ngdialog');

                        if (dialogs.length === 0) {
                            return null;
                        }

                        // TODO: This might be incorrect if there are a mix of open dialogs with
                        // different 'appendTo' values
                        return $el(dialogs[dialogs.length - 1]);
                    },

                    applyAriaAttributes: function ($dialog, options) {
                        if (options.ariaAuto) {
                            if (!options.ariaRole) {
                                var detectedRole = (privateMethods.getFocusableElements($dialog).length > 0) ?
                                    'dialog' :
                                    'alertdialog';

                                options.ariaRole = detectedRole;
                            }

                            if (!options.ariaLabelledBySelector) {
                                options.ariaLabelledBySelector = 'h1,h2,h3,h4,h5,h6';
                            }

                            if (!options.ariaDescribedBySelector) {
                                options.ariaDescribedBySelector = 'article,section,p';
                            }
                        }

                        if (options.ariaRole) {
                            $dialog.attr('role', options.ariaRole);
                        }

                        privateMethods.applyAriaAttribute(
                            $dialog,
                            'aria-labelledby',
                            options.ariaLabelledById,
                            options.ariaLabelledBySelector);

                        privateMethods.applyAriaAttribute(
                            $dialog,
                            'aria-describedby',
                            options.ariaDescribedById,
                            options.ariaDescribedBySelector);
                    },

                    applyAriaAttribute: function ($dialog, attr, id, selector) {
                        if (id) {
                            $dialog.attr(attr, id);
                        }

                        if (selector) {
                            var dialogId = $dialog.attr('id');

                            var firstMatch = $dialog[0].querySelector(selector);

                            if (!firstMatch) {
                                return;
                            }

                            var generatedId = dialogId + '-' + attr;

                            $el(firstMatch).attr('id', generatedId);

                            $dialog.attr(attr, generatedId);

                            return generatedId;
                        }
                    },

                    detectUIRouter: function () {
                        //Detect if ui-router module is installed if not return false
                        try {
                            angular.module('ui.router');
                            return true;
                        } catch (err) {
                            return false;
                        }
                    },

                    getRouterLocationEventName: function () {
                        if (privateMethods.detectUIRouter()) {
                            return '$stateChangeSuccess';
                        }
                        return '$locationChangeSuccess';
                    },

                    showDialog: function ($dialog) {
                        $dialog.css({
                            display: 'block'
                        });
                    },

                    hideDialog: function ($dialog) {
                        $dialog.css({
                            display: 'none'
                        });
                    },

                    closeMinimize: function (minimizedId) {
                        var minimizedElement = document.getElementById(minimizedId);
                        var maximizeBtn      = minimizedElement.getElementsByClassName(
                            "ngdialog-maximize-btn");
                        $el(maximizeBtn[0]).unbind('click');

                        var closeMinimizeBtn = minimizedElement.getElementsByClassName(
                            "ngdialog-close");
                        $el(closeMinimizeBtn).unbind('click');

                        var $minimized = $el(minimizedElement);
                        $minimized.remove();

                        openMinimizedIdStack.splice(openMinimizedIdStack.indexOf(minimizedId), 1);
                        privateMethods.rearrangeMinimizedElements();
                    },

                    rearrangeMinimizedElements: function () {
                        var leftPosition = 0;
                        for (var i = 0; i < openMinimizedIdStack.length; i++) {
                            var minimized    = $el(document.getElementById(openMinimizedIdStack[i]));
                            var elementWidth = minimized[0].offsetWidth;

                            minimized.css({
                                left: leftPosition + "px"
                            });

                            leftPosition += elementWidth + privateMethods.getMarginBetweenMinimizedElements();
                        }
                    },

                    getMarginBetweenMinimizedElements: function () {
                        return 25;
                    },

                    isMoreMinimizedElementsPossible: function () {
                        var windowWidth  = window.innerWidth;
                        var elementWidth = document.getElementsByClassName('ngdialog-minimized').length > 0 ?
                            document.getElementsByClassName('ngdialog-minimized')[0].offsetWidth : 0;

                        var currentLeftStartPosition = (elementWidth + privateMethods.getMarginBetweenMinimizedElements()) * openMinimizedIdStack.length;

                        if ((currentLeftStartPosition + elementWidth) > windowWidth) {
                            alert("No more minimized is possible.");
                            return false;
                        }
                        return true;
                    },

                    showMinimizedPreview: function (minimizedId,
                                                    copiedPreviewContent,
                                                    dialogcontentwidth) {
                        var minimized             = document.getElementById(minimizedId);
                        var minimizedStyle        = window.getComputedStyle(minimized);
                        var minimizedLeftPosition = minimizedStyle.getPropertyValue('left');
                        var minimizedWidth        = minimized.offsetWidth;
                        var minimizedHeight       = minimized.offsetHeight;
                        var zoomlevel             = ((minimizedWidth / dialogcontentwidth) * 100) / 100;

                        var previewContent = $el('<div>' + copiedPreviewContent + '</div>');
                        previewContent.css({
                            zoom: zoomlevel
                        });

                        var preview = $el('<div id="' + minimizedId + '-preview" class="ngdialog-minimized-preview"></div>');
                        preview.css({
                            bottom: minimizedHeight + 'px',
                            left  : minimizedLeftPosition,
                            width : (minimizedWidth - 10) + 'px'
                        });

                        preview.append(previewContent);

                        var body = $el(document.body);
                        body.append(preview);
                    }
                };

                var publicMethods = {
                        __PRIVATE__: privateMethods,

                        /*
                         * @param {Object} options:
                         * - template {String} - id of ng-template, url for partial, plain string (if enabled)
                         * - plain {Boolean} - enable plain string templates, default false
                         * - scope {Object}
                         * - controller {String}
                         * - controllerAs {String}
                         * - className {String} - dialog theme class
                         * - appendClassName {String} - dialog theme class to be appended to defaults
                         * - disableAnimation {Boolean} - set to true to disable animation
                         * - showClose {Boolean} - show close button, default true
                         * - closeByEscape {Boolean} - default true
                         * - closeByDocument {Boolean} - default true
                         * - preCloseCallback {String|Function} - user supplied function name/function called before closing dialog (if set)
                         * - bodyClassName {String} - class added to body at open dialog
                         * - tooltip {Boolean} - if enabled ngDialog will be displayed as a tooltip. Left, top corner has the position where the cursor is. Default false
                         * - mouseEvent {event} - mouse event with coordinates to set up tooltip position
                         * - draggable {Boolean} - move the ngDialog object by clicking on it's header with the mouse and dragging it anywhere within the viewport (if enabled), default false
                         * - top {Number|String} - Starting top position of dialog relative to browser window; may be String ('10px') or Number (10)
                         * - left {Number|String} - Starting left position of dialog relative to browser window; may be String ('10px') or Number (10)
                         * @return {Object} dialog
                         */
                        open: function (opts) {
                            var dialogID = null;
                            opts         = opts || {};
                            if (openOnePerName && opts.name) {
                                dialogID = opts.name + ' dialog';
                                if (this.isOpen(dialogID)) {
                                    return;
                                }
                            }
                            var options = angular.copy(defaults);
                            var localID = ++globalID;
                            dialogID    = dialogID || 'ngdialog' + localID;
                            openIdStack.push(dialogID);

                            // Merge opts.data with predefined via setDefaults
                            if (typeof options.data !== 'undefined') {
                                if (typeof opts.data === 'undefined') {
                                    opts.data = {};
                                }
                                opts.data = angular.merge(angular.copy(options.data), opts.data);
                            }

                            angular.extend(options, opts);

                            var defer;
                            defers[dialogID] = defer = $q.defer();

                            var scope;
                            scopes[dialogID] = scope = angular.isObject(options.scope) ? options.scope.$new() : $rootScope.$new();

                            var $dialog, $dialogParent;

                            var resolve = angular.extend({}, options.resolve);

                            angular.forEach(resolve, function (value, key) {
                                resolve[key] = angular.isString(value) ? $injector.get(value) : $injector.invoke(
                                    value,
                                    null,
                                    null,
                                    key);
                            });

                            $q.all({
                                template: loadTemplate(options.template || options.templateUrl),
                                locals  : $q.all(resolve)
                            }).then(function (setup) {
                                    var template = setup.template,
                                        locals   = setup.locals;

                                    if (options.showClose) {
                                        template += '<div class="ngdialog-close"></div>';
                                    }

                                    if (options.showMinimize) {
                                        template += '<div class="ngdialog-minimize-btn"></div>';
                                    }

                                    var hasOverlayClass = options.overlay ? '' : ' ngdialog-no-overlay';
                                    $dialog             = $el('<div id="' + dialogID + '" class="ngdialog' + hasOverlayClass + '"></div>');

                                    // If showing overlay, Add the overlay HTML
                                    var html = options.overlay ? '<div class="ngdialog-overlay"></div>' : '';

                                    // Add the content HTML
                                    html += '<div class="ngdialog-content" role="document">'

                                    // If dragging, Add the Header HTML
                                    html += options.draggable ? '<div' +
                                    ' class="ngdialog-header"></div>' : '';

                                    // Add the content template
                                    html += template + '</div>';

                                    // Set the html on the actual DOM element
                                    $dialog.html(html);

                                    $dialog.data('$ngDialogOptions', options);

                                    scope.ngDialogId = dialogID;

                                    if (options.data && angular.isString(options.data)) {
                                        var firstLetter               = options.data.replace(/^\s*/, '')[0];
                                        scope.ngDialogData            = (firstLetter === '{' || firstLetter === '[') ? angular.fromJson(
                                            options.data) : new String(options.data);
                                        scope.ngDialogData.ngDialogId = dialogID;
                                    } else if (options.data && angular.isObject(options.data)) {
                                        scope.ngDialogData            = options.data;
                                        scope.ngDialogData.ngDialogId = dialogID;
                                    }

                                    if (options.className) {
                                        $dialog.addClass(options.className);
                                    }

                                    if (options.appendClassName) {
                                        $dialog.addClass(options.appendClassName);
                                    }

                                    if (options.width) {
                                        var $dialogContent = $dialog[0].querySelector('.ngdialog-content');
                                        if (angular.isString(options.width)) {
                                            $dialogContent.style.width = options.width;
                                        } else {
                                            $dialogContent.style.width = options.width + 'px';
                                        }
                                    }

                                    if (options.disableAnimation) {
                                        $dialog.addClass(disabledAnimationClass);
                                    }

                                    if (options.appendTo && angular.isString(options.appendTo)) {
                                        $dialogParent = angular.element(document.querySelector(options.appendTo));
                                    } else {
                                        $dialogParent = $elements.body;
                                    }

                                    privateMethods.applyAriaAttributes($dialog, options);

                                    if (options.preCloseCallback) {
                                        var preCloseCallback;

                                        if (angular.isFunction(options.preCloseCallback)) {
                                            preCloseCallback = options.preCloseCallback;
                                        } else if (angular.isString(options.preCloseCallback)) {
                                            if (scope) {
                                                if (angular.isFunction(scope[options.preCloseCallback])) {
                                                    preCloseCallback = scope[options.preCloseCallback];
                                                } else if (scope.$parent && angular.isFunction(scope.$parent[options.preCloseCallback])) {
                                                    preCloseCallback = scope.$parent[options.preCloseCallback];
                                                } else if ($rootScope && angular.isFunction($rootScope[options.preCloseCallback])) {
                                                    preCloseCallback = $rootScope[options.preCloseCallback];
                                                }
                                            }
                                        }

                                        if (preCloseCallback) {
                                            $dialog.data('$ngDialogPreCloseCallback', preCloseCallback);
                                        }
                                    }

                                    scope.closeThisDialog = function (value) {
                                        privateMethods.closeDialog($dialog, value);
                                    };

                                    if (options.controller && (angular.isString(options.controller) || angular.isArray(
                                            options.controller) || angular.isFunction(options.controller))) {

                                        var label;

                                        if (options.controllerAs && angular.isString(options.controllerAs)) {
                                            label = options.controllerAs;
                                        }

                                        var controllerInstance = $controller(options.controller,
                                            angular.extend(
                                                locals,
                                                {
                                                    $scope  : scope,
                                                    $element: $dialog
                                                }),
                                            true,
                                            label
                                        );

                                        if (options.bindToController) {
                                            angular.extend(controllerInstance.instance,
                                                {
                                                    ngDialogId     : scope.ngDialogId,
                                                    ngDialogData   : scope.ngDialogData,
                                                    closeThisDialog: scope.closeThisDialog
                                                });
                                        }

                                        $dialog.data('$ngDialogControllerController', controllerInstance());
                                    }

                                    $timeout(function () {
                                        var $activeDialogs = document.querySelectorAll('.ngdialog');
                                        privateMethods.deactivateAll($activeDialogs);

                                        $compile($dialog)(scope);
                                        var widthDiffs = $window.innerWidth - $elements.body.prop(
                                                'clientWidth');
                                        $elements.html.addClass(options.bodyClassName);
                                        $elements.body.addClass(options.bodyClassName);
                                        var scrollBarWidth = widthDiffs - ($window.innerWidth - $elements.body.prop(
                                                'clientWidth'));
                                        if (scrollBarWidth > 0) {
                                            privateMethods.setBodyPadding(scrollBarWidth);
                                        }
                                        $dialogParent.append($dialog);

                                        privateMethods.activate($dialog);

                                        if (options.trapFocus) {
                                            privateMethods.autoFocus($dialog);
                                        }

                                        if (options.name) {
                                            $rootScope.$broadcast('ngDialog.opened',
                                                {dialog: $dialog, name: options.name});
                                        } else {
                                            $rootScope.$broadcast('ngDialog.opened', $dialog);
                                        }
                                    });

                                    if (!keydownIsBound) {
                                        $elements.body.bind('keydown', privateMethods.onDocumentKeydown);
                                        keydownIsBound = true;
                                    }

                                    if (options.closeByNavigation) {
                                        var eventName = privateMethods.getRouterLocationEventName();
                                        $rootScope.$on(eventName, function () {
                                            privateMethods.closeDialog($dialog);
                                        });
                                    }

                                    if (options.preserveFocus) {
                                        $dialog.data('$ngDialogPreviousFocus', document.activeElement);
                                    }

                                    closeByDocumentHandler = function (event) {
                                        var isOverlay     = options.closeByDocument ? $el(event.target).hasClass(
                                            'ngdialog-overlay') : false;
                                        var isCloseBtn    = $el(event.target).hasClass('ngdialog-close');
                                        var isMinimizeBtn = $el(event.target).hasClass(
                                            'ngdialog-minimize-btn');

                                        if (isOverlay || isCloseBtn) {
                                            publicMethods.close($dialog.attr('id'),
                                                isCloseBtn ? '$closeButton' : '$document');
                                        }

                                        if (isMinimizeBtn) {
                                            publicMethods.minimize($dialog.attr('id'),
                                                options.minimizedTitle);
                                        }
                                    };

                                    if (typeof $window.Hammer !== 'undefined') {
                                        var hammerTime = scope.hammerTime = $window.Hammer($dialog[0]);
                                        hammerTime.on('tap', closeByDocumentHandler);
                                    } else {
                                        $dialog.bind('click', closeByDocumentHandler);
                                    }

                                    if (options.left || options.top) {
                                        var elDialogContent = $el($dialog[0].querySelector(
                                            '.ngdialog-content'));
                                        if (elDialogContent !== null) {
                                            var position = {
                                                position: 'absolute'
                                            };

                                            if (options.left !== null) {
                                                position.left = options.left + 'px';
                                            }
                                            if (options.top !== null) {
                                                position.top = options.top + 'px';
                                            }

                                            elDialogContent.css(position);
                                        }
                                    }

                                    if (options.tooltip && options.mouseEvent !== null) {
                                        var elDialogContent = $el($dialog[0].querySelector(
                                            '.ngdialog-content'));
                                        if (elDialogContent !== null) {
                                            //set new position for the ngDialog (tooltip)
                                            elDialogContent.css({
                                                top     : options.mouseEvent.pageY + 'px',
                                                left    : options.mouseEvent.pageX + 'px',
                                                position: 'absolute'
                                            });
                                        }
                                    }

                                    if (options.draggable) {
                                        var dialogContent   = $dialog[0].querySelector('.ngdialog-content');
                                        var elDialogContent = $el(dialogContent);

                                        if (dialogContent !== null) {
                                            var elHeader = $el($dialog[0].querySelector('.ngdialog-header'));

                                            elHeader.on('mousedown', function (event) {
                                                    var winClientRect    = $dialog[0].getBoundingClientRect();
                                                    var winHeight        = winClientRect.height;
                                                    var winWidth         = winClientRect.width;
                                                    var dialogClientRect = dialogContent.getBoundingClientRect();
                                                    var dialogHeight     = dialogClientRect.height;
                                                    var dialogWidth      = dialogClientRect.width;

                                                    if (!options.tooltip) {
                                                        elDialogContent.css({
                                                            top     : dialogClientRect.top + 'px',
                                                            left    : dialogClientRect.left + 'px',
                                                            position: 'absolute'
                                                        });
                                                    }

                                                    var x = parseInt(elDialogContent.css('left') || dialogClientRect.left,
                                                        10);
                                                    var y = parseInt(elDialogContent.css('top') || dialogClientRect.top,
                                                        10);

                                                    var startX = event.screenX - x;
                                                    var startY = event.screenY - y;


                                                    var mousemove = function (ev) {
                                                        y = ev.screenY - startY;
                                                        x = ev.screenX - startX;

                                                        // Prevent dialog from being dragged outside
                                                        // of browser window
                                                        if (y < 0)
                                                            y = 0;
                                                        else if (y > winHeight - dialogHeight)
                                                            y = winHeight - dialogHeight;

                                                        if (x > winWidth - dialogWidth)
                                                            x = winWidth - dialogWidth;
                                                        else if (x < 0)
                                                            x = 0;

                                                        $el(dialogContent).css({
                                                            top : y + 'px',
                                                            left: x + 'px'
                                                        });
                                                        window.getSelection().removeAllRanges();
                                                    };

                                                    var mouseup = function (ev) {
                                                        $document.unbind('mousemove', mousemove);
                                                        $document.unbind('mouseup', mouseup);
                                                    };

                                                    $document.on('mousemove', mousemove);

                                                    $document.on('mouseup', mouseup);
                                                }
                                            );
                                        }
                                    }

                                    dialogsCount += 1;

                                    return publicMethods;
                                }
                            );

                            return {
                                id          : dialogID,
                                closePromise: defer.promise,
                                close       : function (value) {
                                    privateMethods.closeDialog($dialog, value);
                                }
                            };

                            function loadTemplateUrl(tmpl, config) {
                                $rootScope.$broadcast('ngDialog.templateLoading', tmpl);
                                return $http.get(tmpl, (config || {})).then(function (res) {
                                    $rootScope.$broadcast('ngDialog.templateLoaded', tmpl);
                                    return res.data || '';
                                });
                            }

                            function loadTemplate(tmpl) {
                                if (!tmpl) {
                                    return 'Empty template';
                                }

                                if (angular.isString(tmpl) && options.plain) {
                                    return tmpl;
                                }

                                if (typeof options.cache === 'boolean' && !options.cache) {
                                    return loadTemplateUrl(tmpl, {cache: false});
                                }

                                return loadTemplateUrl(tmpl, {cache: $templateCache});
                            }
                        },

                        /*
                         * @param {Object} options:
                         * - template {String} - id of ng-template, url for partial, plain string (if enabled)
                         * - plain {Boolean} - enable plain string templates, default false
                         * - name {String}
                         * - scope {Object}
                         * - controller {String}
                         * - controllerAs {String}
                         * - className {String} - dialog theme class
                         * - appendClassName {String} - dialog theme class to be appended to defaults
                         * - showClose {Boolean} - show close button, default true
                         * - closeByEscape {Boolean} - default false
                         * - closeByDocument {Boolean} - default false
                         * - preCloseCallback {String|Function} - user supplied function name/function called before closing dialog (if set); not called on confirm
                         * - bodyClassName {String} - class added to body at open dialog
                         * - tooltip {Boolean} - if enabled ngDialog will be displayed as a tooltip. Left, top corner has the position where the cursor is. Default false
                         * - mouseEvent {event} - mouse event with coordinates to set up tooltip position
                         * - draggable {Boolean} - move the ngDialog object by clicking on it's header with the mouse and dragging it anywhere within the viewport (if enabled), default false
                         * - top {Number|String} - Starting top position of dialog relative to browser window; may be String ('10px') or Number (10)
                         * - left {Number|String} - Starting left position of dialog relative to browser window; may be String ('10px') or Number (10)
                         * @return {Object} dialog
                         */
                        openConfirm: function (opts) {
                            var defer   = $q.defer();
                            var options = angular.copy(defaults);

                            opts = opts || {};

                            // Merge opts.data with predefined via setDefaults
                            if (typeof options.data !== 'undefined') {
                                if (typeof opts.data === 'undefined') {
                                    opts.data = {};
                                }
                                opts.data = angular.merge(angular.copy(options.data), opts.data);
                            }

                            angular.extend(options, opts);

                            options.scope         = angular.isObject(options.scope) ? options.scope.$new() : $rootScope.$new();
                            options.scope.confirm = function (value) {
                                defer.resolve(value);
                                var $dialog = $el(document.getElementById(openResult.id));
                                privateMethods.performCloseDialog($dialog, value);
                            };

                            var openResult = publicMethods.open(options);
                            if (openResult) {
                                openResult.closePromise.then(function (data) {
                                    if (data) {
                                        return defer.reject(data.value);
                                    }
                                    return defer.reject();
                                });
                                return defer.promise;
                            }
                        }
                        ,

                        isOpen: function (id) {
                            var $dialog = $el(document.getElementById(id));
                            return $dialog.length > 0;
                        }
                        ,

                        /*
                         * @param {String} id
                         * @return {Object} dialog
                         */
                        close: function (id, value) {
                            var $dialog = $el(document.getElementById(id));

                            if ($dialog.length) {
                                privateMethods.closeDialog($dialog, value);
                            } else {
                                if (id === '$escape') {
                                    var topDialogId = openIdStack[openIdStack.length - 1];
                                    $dialog         = $el(document.getElementById(topDialogId));
                                    if ($dialog.data('$ngDialogOptions').closeByEscape) {
                                        privateMethods.closeDialog($dialog, '$escape');
                                    }
                                } else {
                                    publicMethods.closeAll(value);
                                }
                            }

                            return publicMethods;
                        }
                        ,

                        closeAll: function (value) {
                            var $all = document.querySelectorAll('.ngdialog');

                            // Reverse order to ensure focus restoration works as expected
                            for (var i = $all.length - 1; i >= 0; i--) {
                                var dialog = $all[i];
                                privateMethods.closeDialog($el(dialog), value);
                            }
                        }
                        ,

                        minimize: function (id, minimizedTitle) {
                            if (!privateMethods.isMoreMinimizedElementsPossible())
                                return;
                            var dialogElement = document.getElementById(id);
                            var $dialog       = $el(dialogElement);
                            var minimizedId   = id + '-minimized';
                            openMinimizedIdStack.push(minimizedId);
                            // save the width of the dialog content before hiding it
                            var dialogContentWidth = dialogElement.getElementsByClassName(
                                'ngdialog-content')[0].offsetWidth
                            privateMethods.hideDialog($dialog);
                            var titleElement = $el('<div class="ngdialog-minimized-title">' + minimizedTitle + '<div>');
                            titleElement.bind('mouseover', function (event) {
                                var dialog            = document.getElementById(id);
                                var copyDialogContent = dialog.getElementsByClassName('ngdialog-content')[0].innerHTML;
                                privateMethods.showMinimizedPreview(minimizedId,
                                    copyDialogContent,
                                    dialogContentWidth);
                            });

                            titleElement.bind('mouseout', function (event) {
                                var mini = $el(document.getElementById(minimizedId + '-preview'));
                                mini.remove();
                            });

                            var maximizeButton = $el('<div class="ngdialog-maximize-btn"></div>');
                            maximizeButton.bind('click', function (event) {
                                privateMethods.closeMinimize(minimizedId);
                                privateMethods.showDialog($dialog);
                            });

                            var closeButton = $el('<div class="ngdialog-minimized-close"></div>');
                            closeButton.bind('click', function (event) {
                                privateMethods.closeDialog($dialog, '$closeButton');
                                privateMethods.closeMinimize(minimizedId);
                            });
                            var minimizedElement = $el('<div id="' + minimizedId + '" class="ngdialog-minimized"></div>');

                            minimizedElement.append(titleElement);
                            minimizedElement.append(maximizeButton);
                            minimizedElement.append(closeButton);
                            $elements.body.append(minimizedElement);
                            privateMethods.rearrangeMinimizedElements();
                        },

                        getOpenDialogs: function () {
                            return openIdStack;
                        }
                        ,

                        getDefaults: function () {
                            return defaults;
                        }
                    }
                    ;

                angular.forEach(
                    ['html', 'body'],
                    function (elementName) {
                        $elements[elementName] = $document.find(elementName);
                        if (forceElementsReload[elementName]) {
                            var eventName = privateMethods.getRouterLocationEventName();
                            $rootScope.$on(eventName, function () {
                                $elements[elementName] = $document.find(elementName);
                            });
                        }
                    }
                );

                return publicMethods;
            }]
        ;
    })
    ;

    m.directive('ngDialog', ['ngDialog', function (ngDialog) {
        return {
            restrict: 'A',
            scope   : {
                ngDialogScope: '='
            },
            link    : function (scope, elem, attrs) {
                elem.on('click', function (e) {
                    e.preventDefault();

                    var ngDialogScope = angular.isDefined(scope.ngDialogScope) ? scope.ngDialogScope : 'noScope';
                    angular.isDefined(attrs.ngDialogClosePrevious) && ngDialog.close(attrs.ngDialogClosePrevious);

                    var defaults = ngDialog.getDefaults();

                    ngDialog.open({
                        template        : attrs.ngDialog,
                        className       : attrs.ngDialogClass || defaults.className,
                        appendClassName : attrs.ngDialogAppendClass,
                        controller      : attrs.ngDialogController,
                        controllerAs    : attrs.ngDialogControllerAs,
                        bindToController: attrs.ngDialogBindToController,
                        scope           : ngDialogScope,
                        data            : attrs.ngDialogData,
                        showClose       : attrs.ngDialogShowClose === 'false' ? false : (attrs.ngDialogShowClose === 'true' ? true : defaults.showClose),
                        closeByDocument : attrs.ngDialogCloseByDocument === 'false' ? false : (attrs.ngDialogCloseByDocument === 'true' ? true : defaults.closeByDocument),
                        closeByEscape   : attrs.ngDialogCloseByEscape === 'false' ? false : (attrs.ngDialogCloseByEscape === 'true' ? true : defaults.closeByEscape),
                        overlay         : attrs.ngDialogOverlay === 'false' ? false : (attrs.ngDialogOverlay === 'true' ? true : defaults.overlay),
                        preCloseCallback: attrs.ngDialogPreCloseCallback || defaults.preCloseCallback,
                        bodyClassName   : attrs.ngDialogBodyClass || defaults.bodyClassName,
                        draggable       : attrs.ngDialogDraggable === 'false' ? false : (attrs.ngDialogDraggable === 'true' ? true : defaults.draggable),
                        tooltip         : attrs.ngDialogTooltip === 'false' ? false : (attrs.ngDialogTooltip === 'true' ? true : defaults.tooltip),
                        mouseEvent      : attrs.ngDialogTooltip === 'false' ? null : e,
                        showMinimized   : attrs.ngDialogShowMinimized === 'false' ? false : (attrs.ngDialogShowMinimized === 'true' ? true : defaults.showMinimized),
                        minimizedTitle  : attrs.ngDialogMinimizedTitle || defaults.minimizedTitle,
                        top             : attrs.ngDialogTop ? parseInt(attrs.ngDialogTop, 10) : defaults.top,
                        left            : attrs.ngDialogLeft ? parseInt(attrs.ngDialogLeft, 10) : defaults.bottom
                    });
                });
            }
        };
    }]);

    return m;
}))
;
