/**
 * MIT License
 *
 *    Copyright (c) 2016-2019 June07
 *
 *    Permission is hereby granted, free of charge, to any person obtaining a copy
 *    of this software and associated documentation files (the "Software"), to deal
 *    in the Software without restriction, including without limitation the rights
 *    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *    copies of the Software, and to permit persons to whom the Software is
 *    furnished to do so, subject to the following conditions:
 *
 *    The above copyright notice and this permission notice shall be included in all
 *    copies or substantial portions of the Software.
 *
 *    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *    SOFTWARE.
*/
var ngApp = angular.module('NimBackgroundApp', []);
ngApp
    .run(function() {})
    .controller('nimController', ['$scope', '$window', '$http', '$q', function($scope, $window, $http, $q) {
        const VERSION = '0.0.0'; // Filled in by Grunt
        const UPTIME_CHECK_INTERVAL = 60 * 15; // 15 minutes 
        const INSTALL_URL = "https://bit.ly/2HBlRs1";
        const UNINSTALL_URL = "https://bit.ly/2vUcRNn";
        const JUNE07_ANALYTICS_URL = 'https://analytics.june07.com';
        const SHORTNER_SERVICE_URL = 'https://shortnr.june07.com/api'
        const UPTIME_CHECK_RESOLUTION = 60000; // Check every minute
        const DEVEL = true;
        const IP_PATTERN = /(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])/;
        const devToolsURL_Regex = /(chrome-devtools:\/\/|https:\/\/chrome-devtools-frontend(.appspot.com|.june07.com)).*(inspector.html|js_app.html)/;

        $window.chrome.management.getSelf((ExtensionInfo) => {
            $scope.ExtensionInfo = ExtensionInfo;
        });
        getChromeIdentity()

        $scope.loaded = Date.now();
        $scope.timerUptime = 0;
        $scope.timerNotification = 0;
        $scope.VERSION = VERSION;
        $scope.settingsRevised = {
            localDevToolsOptions: [
                { 'id': '0', 'name': 'default', 'url': '', 'selected': true },
                { 'id': '1', 'name': 'appspot', 'url': 'https://chrome-devtools-frontend.appspot.com/serve_file/@548c459fb7741b83bd517b12882f533b04a5513e/inspector.html' },
                { 'id': '2', 'name': 'june07', 'url': 'https://chrome-devtools-frontend.june07.com/front_end/inspector.html' },
                { 'id': '3', 'name': 'custom', 'url': '' },
            ]
        };
        $scope.settings = {
            DEVEL: DEVEL,
            host: "localhost",
            port: "9229",
            auto: true,
            checkInterval: 500,
            remoteProbeInterval: 10000,
            localSessionTimeout: DEVEL ? 7*24*60*60000 : 7*24*60*60000,
            debugVerbosity: 0,
            checkIntervalTimeout: null,
            newWindow: false,
            autoClose: false,
            tabActive: true,
            windowFocused: true,
            localDevTools: true,
            notifications: {
                showMessage: false,
                lastHMAC: 0
            },
            chromeNotifications: true,
            autoIncrement: {type: 'port', name: 'Port'}, // both | host | port | false
            collaboration: false,
            localDevToolsOptions: $scope.settingsRevised.localDevToolsOptions,
            panelWindowType: false
        };
        $scope.remoteTabs = [];
        $scope.localSessions = [];
        $scope.state = {
            popup: {
                selectedTab: undefined
            }
        }
        $scope.notifications;
        $scope.devToolsSessions = [];
        $scope.changeObject;
        $scope.userInfo;
        $scope.sessionlessTabs = [];
        $scope.locks = [];
        $scope.moment = $window.moment;
        $scope.getDevToolsOption = function() {
            return $scope.settings.localDevToolsOptions.find((option) => {
                return option.selected;
            });
        };
        $scope.validateCustomDevToolsURL = function() {
            if ($scope.settings.localDevToolsOptions[3].url === undefined)
                $scope.settings.localDevToolsOptions[3].url = $scope.settings.localDevToolsOptions[1].url;
            else if (!$scope.settings.localDevToolsOptions[3].url.match(devToolsURL_Regex))
                $scope.settings.localDevToolsOptions[3].url = $scope.settings.localDevToolsOptions[1].url;
        }

        let tabId_HostPort_LookupTable = [],
            backoffTable = [],
            promisesToUpdateTabsOrWindows = [],
            chrome = $window.chrome,
            SingletonHttpGet = httpGetTestSingleton(),
            SingletonOpenTabInProgress = openTabInProgressSingleton(),
            triggerTabUpdate = false,
            websocketIdLastLoaded = null,
            tabNotificationListeners = [];
        $scope.tabId_HostPort_LookupTable = tabId_HostPort_LookupTable;

        restoreSettings();
        updateInternalSettings() // This function is needed for settings that aren't yet configurable via the UI.  Otherwise the new unavailable setting will continue to be reset with whatever was saved vs the defaults.
        setInterval(function() {
            $scope.timerUptime++;
            if (($scope.timerUptime >= UPTIME_CHECK_INTERVAL && $scope.timerUptime % UPTIME_CHECK_INTERVAL === 0) || ($scope.timerUptime === 1)) {
                $window._gaq.push(['_trackEvent', 'Program Event', 'Uptime Check', $scope.moment.duration($scope.timerUptime, 'seconds').humanize(), undefined, true ],
                ['_trackEvent', 'Program Event', 'Version Check', VERSION + " " + $scope.userInfo, undefined, true]);
            }
        }, UPTIME_CHECK_RESOLUTION);

        class Timer {
            constructor(args) {
                let self = this;
                self.sessionID = args.sessionID;
                self.expired = false;
                self.elapsed = 0;
                self.timeout = $scope.settings.localSessionTimeout;
                self.timerID = setTimeout(() => { $scope.updateLocalSessions(self.sessionID) }, self.timeout);
                setInterval(() => {
                    self.elapsed = self.elapsed + 1000;
                    if (self.getRemainingTime() <= 0) self.expired = true;
                }, 1000);
            }
            clearTimer() {
                let self = this;
                clearInterval(self.timerID);
            }
            getRemainingTime() {
                let self = this;
                return self.timeout - self.elapsed;
            }
        }
        $scope.updateLocalSessions = function(expired) {
            if (expired) return $scope.localSessions.splice($scope.localSessions.findIndex(session => session.id === expired.id), 1);
            
            let localSessions = $scope.devToolsSessions.filter(session => session.infoUrl.search(/\/\/n2p.june07.com\/json\//) === -1);
            localSessions = localSessions.map((session) => {
                session.timer = new Timer({sessionID: session.id});
                return session;
            });
            //$scope.localSessions = localSessions.concat($scope.localSessions);
            $scope.localSessions = $scope.localSessions.concat(localSessions);
            localSessions = [];
            return $scope.localSessions = $scope.localSessions.filter((session, i) => {
                if (i === 0) {
                    localSessions.push(session);
                    return true;
                }
                let match = localSessions.find(s => s.infoUrl === session.infoUrl);
                if (match === undefined) {
                    localSessions.push(session);
                    return true;
                } else {
                    session.timer.clearTimer();
                    return false;
                }
            });
        }
        $scope.removeLocalSession = function(id) {
            let index = $scope.localSessions.findIndex(session => session.id == id)
            if (index != -1) $scope.localSessions.splice(index, 1)
            $scope.devToolsSessions.find((session, i) => {
                if (session.id == id) {
                    removeDevToolsSession(session, i)
                }
            })
            
        }
        $scope.localize = function($window, updateUI) {
            Array.from($window.document.getElementsByClassName("i18n")).forEach(function(element, i, elements) {
                var message;
                // Hack until I can figure out how to resize the overlay properly.
                if (chrome.i18n.getUILanguage() == "ja") element.style.fontSize = "small";
                switch (element.id) {
                    case "open devtools": message = chrome.i18n.getMessage("openDevtools"); element.value = message; break;
                    case "checkInterval-value": message = chrome.i18n.getMessage(element.dataset.badgeCaption); element.dataset.badgeCaption = message; break;
                    default: message = chrome.i18n.getMessage(element.innerText.split(/\s/)[0]);
                        element.textContent = message; break;
                }
                if (i === (elements.length-1)) updateUI();
            });
        }
        $scope.save = function(key) {
            //
            write(key, $scope.settings[key]);
        }
        $scope.openTab = function(host, port, callback) {
            SingletonOpenTabInProgress.getInstance(host, port, null)
            .then(function(value) {
                if (value.message !== undefined) {
                    return callback(value.message);
                } else {
                    SingletonOpenTabInProgress.getInstance(host, port, 'lock')
                    .then(function() {
                        var infoUrl = getInfoURL(host, port);
                        chrome.tabs.query({
                            url: [// 'chrome-devtools://*/*',
                                'chrome-devtools://*/*localhost:' + port + '*',
                                'chrome-devtools://*/*' + host + ':' + port + '*',
                                'chrome-devtools://*/*' + host + '/ws/' + port + '*',

                                'https://chrome-devtools-frontend.june07.com/*localhost:' + port + '*',                                
                                'https://chrome-devtools-frontend.june07.com/*' + host + ':' + port + '*',
                                'https://chrome-devtools-frontend.june07.com/*' + host + '/ws/' + port + '*',

                                'https://chrome-devtools-frontend.appspot.com/*localhost:' + port + '*',
                                'https://chrome-devtools-frontend.appspot.com/*' + host + ':' + port + '*',
                                'https://chrome-devtools-frontend.appspot.com/*' + host + '/ws/' + port + '*'
                            ]
                        }, function(tab) {
                            if ($http.pendingRequests.length !== 0) return
                            $http({
                                    method: "GET",
                                    url: infoUrl,
                                    responseType: "json"
                            })
                            .then(function openDevToolsFrontend(json) {
                                if (!json.data[0].devtoolsFrontendUrl) return callback(chrome.i18n.getMessage("errMsg7", [host, port]));
                                $scope.settings.localDevToolsOptions[0].url = json.data[0].devtoolsFrontendUrl.split('?')[0];
                                var url = json.data[0].devtoolsFrontendUrl.replace(/ws=localhost/, 'ws=127.0.0.1');
                                var inspectIP = url.match(IP_PATTERN)[0];
                                url = url
                                    .replace(inspectIP + ":9229", host + ":" + port) // In the event that remote debugging is being used and the infoUrl port (by default 80) is not forwarded.
                                    .replace(inspectIP + ":" + port, host + ":" + port) // A check for just the port change must be made.
                                if ($scope.settings.localDevTools)
                                    url = url.replace(devToolsURL_Regex, $scope.getDevToolsOption().url);
                                if ($scope.settings.bugfix)
                                    url = url.replace('', '');
                                var websocketId = json.data[0].id;
                                /** May be a good idea to put this somewhere further along the chain in case tab/window creation fails,
                                in which case this entry will need to be removed from the array */
                                // The following analytics setting is TOO verbose.
                                //$window._gaq.push(['_trackEvent', 'Program Event', 'openTab', 'Non-existing tab.', undefined, true]);
                                if (tab.length === 0) {
                                    createTabOrWindow(infoUrl, url, websocketId, json.data[0])
                                    .then(function(tab) {
                                        var tabToUpdate = tab;
                                        chrome.tabs.onUpdated.addListener(function(tabId, changeInfo) {
                                            if (triggerTabUpdate && tabId === tabToUpdate.id && changeInfo.status === 'complete') {
                                                triggerTabUpdate = false;
                                                saveSession(url, infoUrl, websocketId, tabToUpdate.id, json.data[0]);
                                                callback(tabToUpdate.url);
                                            } else if (!triggerTabUpdate && tabId === tabToUpdate.id) {
                                                if ($scope.settings.debugVerbosity >= 6) console.log('Loading updated tab [' + tabId + ']...');
                                            }
                                        });
                                    })
                                    .then(callback);
                                } else {
                                    // If the tab has focus then issue this... otherwise wait until it has focus (ie event listener for window event.  If another request comes in while waiting, just update the request with the new info but still wait if focus is not present.
                                    var promiseToUpdateTabOrWindow = new Promise(function(resolve) {
                                        chrome.tabs.query({
                                            url: [// 'chrome-devtools://*/*',
                                                'chrome-devtools://*/*localhost:' + port + '*',
                                                'chrome-devtools://*/*' + host + ':' + port + '*',
                                                'chrome-devtools://*/*' + host + '/ws/' + port + '*',

                                                'https://chrome-devtools-frontend.june07.com/*localhost:' + port + '*',                                
                                                'https://chrome-devtools-frontend.june07.com/*' + host + ':' + port + '*',
                                                'https://chrome-devtools-frontend.june07.com/*' + host + '/ws/' + port + '*',

                                                'https://chrome-devtools-frontend.appspot.com/*localhost:' + port + '*',
                                                'https://chrome-devtools-frontend.appspot.com/*' + host + ':' + port + '*',
                                                'https://chrome-devtools-frontend.appspot.com/*' + host + '/ws/' + port + '*'
                                            ]
                                        }, function callback(tab) {
                                            // Resolve otherwise let the event handler resolve
                                            tab = tab[0];
                                            if (tab && tab.active) {
                                                chrome.windows.get(tab.windowId, function(window) {
                                                    if (window.focused) return resolve();
                                                });
                                            } else if ($scope.settings.windowFocused) {
                                                return resolve();
                                            }
                                            addPromiseToUpdateTabOrWindow(tab, promiseToUpdateTabOrWindow);
                                        });
                                    })
                                    .then(function() {
                                        updateTabOrWindow(infoUrl, url, websocketId, tab[0], callback);
                                    });
                                }
                                //unlock(host, port);
                            })
                            .catch(function(error) {
                                if (error.status === -1) {
                                    var message = chrome.i18n.getMessage("errMsg4"); // Connection to DevTools host was aborted.  Check your host and port.
                                    callback({ statusText: message });
                                } else {
                                    callback(error);
                                }
                            });
                        });
                    });
                }
            });
        }
        $scope.$on('options-window-closed', function() {
            //
            saveAll();
            resetInterval($scope.settings.checkIntervalTimeout);
        });
        $scope.$on('options-window-focusChanged', function() {
            // Only if an event happened
            saveAll();
        });
        $scope.tabNotification = function(instance) {
            let tabId = $scope.tabId_HostPort_LookupTable.find(r => r.host === instance.host && r.port == instance.port);
            if (tabId === undefined) return;
            tabId = tabId.id;
            
            // Currently not sure if chrome-devtools:// scheme can be injected into
            chrome.tabs.get(tabId, (tab) => {
                if (tab === undefined || tab.url.match(/chrome-devtools:\/\//)) {
                    return
                } else {
                    var nodeProgram = $scope.devToolsSessions.find(r => r.id == tabId);
                    nodeProgram = (nodeProgram !== undefined) ? nodeProgram.nodeInspectMetadataJSON.title : 'NiM';
                    let jsInject = `
                    debugger
                    window.nimTabNotification = (window.nimTabNotification === undefined) ? {} : window.nimTabNotification;
                    function createLinkElement(type) {
                        let link = document.createElement('link')
                        link.type = 'image/x-icon';
                        link.rel = 'shortcut icon';
                        link.id = 'NiMFavicon';
                        if (type === 'nim') link.href = 'https://june07.github.io/image/icon/favicon16.ico';
                        else link.href = 'https://chrome-devtools-frontend.appspot.com/favicon.ico';
                        return link;
                    }
                    var original = { title: document.URL, link: createLinkElement() }
                    var NiM = { title: '` + nodeProgram + `', link: createLinkElement('nim') }

                    var icon, title;
                    var interval = setInterval(function() {
                        icon = (icon === original.link) ? NiM.link : original.link;
                        title = (title === original.title) ? NiM.title : original.title;
                        document.title = title;
                        var favicon = document.getElementById('NiMFavicon');
                        if (favicon) document.getElementsByTagName('head')[0].removeChild(favicon);
                        document.getElementsByTagName('head')[0].appendChild(icon);
                    }, 500);
                    setTimeout(() => {
                        window.unBlink(` + tabId + `);
                    }, 30000);
                    window.unBlink = (tabId) => {
                        clearInterval(nimTabNotification[tabId].interval);
                        document.title = original.title;
                        document.getElementsByTagName('head')[0].appendChild(NiM.link);
                    }
                    window.nimTabNotification[` + tabId + `] = { interval };
                    `;

                    chrome.tabs.executeScript(tabId, { code: jsInject, allFrames: true }, () => {
                        tabNotificationListenerManager(tabId);
                        console.log('Blinking tab.');
                    });
                }
            })
        }
        function tabNotificationListenerManager(tabId, action) {
            if (action === undefined) {
                tabNotificationListeners[tabId] = {
                    ['fn' + tabId]: function(activeInfo) {
                        if (activeInfo.tabId === tabId) {
                            chrome.tabs.executeScript(tabId, { code: 'window.unBlink(' + tabId + ')' }, () => {
                                tabNotificationListenerManager(tabId, 'remove');
                                console.log('Stopped blinking tab.');
                            });
                        }
                    }
                }
                chrome.tabs.onActivated.addListener(tabNotificationListeners[tabId]['fn' + tabId]);
            } else if (action === 'remove') {
                chrome.tabs.onActivated.removeListener(tabNotificationListeners[tabId]);
            }
        }
        function Backoff(instance, min, max) {
            return {
                max: max,
                min: min,
                delay: 0,
                checkCount: 0,
                checkCounts: [ 6, 12, 24, 48, 96, 192, 364, 728, 14056 ],
                instance: instance,
                increment: function() {
                    if (this.checkCounts.indexOf(this.checkCount) !== -1) {
                        var nextDelay = this.delay + this.min;
                        if (this.max >= nextDelay) this.delay = nextDelay;
                    } else if (this.checkCount > 14056) {
                        this.delay = this.max;
                    }              
                    this.checkCount++;
                    return this;
                },
                reset: function() {
                    this.delay = 0;
                    this.checkCount = 0;
                    return this;
                }
            }
        }
        (function startInterval() {
            if ($scope.settings.debugVerbosity >= 1) console.log('Starting up.')
            resetInterval();
        })();
        function resetInterval(timeout) {
            if (timeout) {
                clearInterval(timeout);
            }
            $scope.settings.checkIntervalTimeout = setInterval(function() {
                if ($scope.settings.auto && ! isLocked(getInstance())) {
                    if ($scope.settings.debugVerbosity >= 6) console.log('resetInterval going thru a check loop...')
                    closeDevTools(
                    $scope.openTab($scope.settings.host, $scope.settings.port, function(message) {
                        if ($scope.settings.debugVerbosity >= 3) console.log(message);
                    }));
                } else if ($scope.settings.auto && isLocked(getInstance())) {
                    /** If the isLocked(getInstance()) is set then we still have to check for disconnects on the client side via httpGetTest().
                    until there exists an event for the DevTools websocket disconnect.  Currently there doesn't seem to be one
                    that we can use simultanous to DevTools itself as only one connection to the protocol is allowed at a time.
                    */
                    SingletonHttpGet.getInstance({ host: $scope.settings.host, port: $scope.settings.port });
                }
                $scope.localSessions.forEach(function(localSession) {
                    let instance = getInstanceFromInfoURL(localSession.infoUrl)
                    if (instance.host === $scope.settings.host && instance.port == $scope.settings.port) return
                    if (localSession.auto && ! isLocked(instance)) {
                        if ($scope.settings.debugVerbosity >= 6) console.log('resetInterval going thru a check loop...')
                        closeDevTools(
                            $scope.openTab(instance.host, instance.port, function(message) {
                                if ($scope.settings.debugVerbosity >= 3) console.log(message)
                            })
                        )
                    } else if (localSession.auto && isLocked(instance)) {
                        /** If the isLocked(getInstance()) is set then we still have to check for disconnects on the client side via httpGetTest().
                        until there exists an event for the DevTools websocket disconnect.  Currently there doesn't seem to be one
                        that we can use simultanous to DevTools itself as only one connection to the protocol is allowed at a time.
                        */
                        SingletonHttpGet.getInstance(instance);
                    }
                })
            }, $scope.settings.checkInterval);
        }
        function httpGetTestSingleton() {
            var promise;

            function closeDefunctDevTools(instance) {
                unlock(instance);
                closeDevTools(function() {
                    var message = 'Closed defunct DevTools session.';
                    if ($scope.settings.debugVerbosity >= 3) console.log(message);
                });
            }
            function createInstance(instance) {
                var host = instance.host,
                    port = instance.port;

                if (promise !== undefined) {
                    if ($scope.settings.debugVerbosity >= 6) console.log("httpGetTestSingleton promise not settled.");
                } else {
                    promise = httpGetTest(host, port)
                    .then(function(up) {
                        if ($scope.settings.debugVerbosity >= 7) console.log('Going thru a check loop [2nd]...')
                        var devToolsSession = $scope.devToolsSessions.find(function(session) {
                            if (session.infoUrl === getInfoURL($scope.settings.host, $scope.settings.port)) return true;
                        })
                        if (!up && (devToolsSession !== undefined)) {
                            closeDefunctDevTools(instance);
                        } else if (!up) {
                            if ($scope.settings.debugVerbosity >= 7) console.log('No DevTools instance detected.  Skipping [1st] check loop...')
                        } else if (up && (devToolsSession !== undefined)) {
                            getTabsCurrentSocketId(devToolsSession.infoUrl)
                            .then(function(socketId) {
                                if (devToolsSession.websocketId !== socketId) closeDefunctDevTools(instance);
                            });
                        } else if (up) {
                            unlock(instance);
                        }
                    })
                    .then(function(value) {
                        promise = value;
                    })
                    .catch(function(error) {
                        if ($scope.settings.debugVerbosity >= 6) console.log('ERROR: ' + error);
                    });
                    return promise;
                }
            }
            return {
                getInstance: function(instance) {
                    return createInstance(instance);
                },
                isComplete: function() {
                    if (promise === undefined) return true;
                    return false; 
                },
                closeDefunctDevTools: closeDefunctDevTools
            }
        }
        function delay(milliseconds) {
            return $q(function(resolve) {
                var interval;
                if ($scope.settings.debugVerbosity) {
                    interval = setInterval(function() {
                        if ($scope.settings.debugVerbosity >= 7) console.log('.');
                    }, 200)
                }
                setTimeout(function() {
                    if (interval !== undefined) clearInterval(interval);
                    resolve();
                }, milliseconds);
            });
        }
        function getTabsCurrentSocketId(infoUrl) {
            return $http({
                method: "GET",
                url: infoUrl,
                responseType: "json"
            })
            .then(function openDevToolsFrontend(json) {
                return json.data[0].id;
            })
            .catch(function(error) {
                return error;
            });
        }
        function closeDevTools(callback) {
            var devToolsSessions = $scope.devToolsSessions;
            devToolsSessions.forEach(function(devToolsSession, index) {
                if (devToolsSession.autoClose) {
                    $http({
                            method: "GET",
                            url: devToolsSession.infoUrl,
                            responseType: "json"
                        })
                        .then(function(response) {
                            var activeDevToolsSessionWebsocketId = response.data[0].id;
                            if (devToolsSession.websocketId !== activeDevToolsSessionWebsocketId) {
                                removeDevToolsSession(devToolsSession, index);
                            }
                        })
                        .catch(function(error) {
                            if (error.status === -1) {
                                if ($scope.settings.debugVerbosity >= 9) console.log("ERROR [line 324]");
                                removeDevToolsSession(devToolsSession, index);
                            } else {
                                if ($scope.settings.debugVerbosity >= 9) console.log('<br>' + chrome.i18n.getMessage("errMsg3") + (devToolsSession.isWindow ? 'window' : 'tab') + error);
                            }
                        });
                }
                if (index >= devToolsSessions.length) {
                    callback();
                }
            });
        }
        function getInfoURL(host, port, protocol) {
            if (protocol === undefined) protocol = 'http';
            return protocol + '://' + host + ':' + port + '/json';
        }
        function getInstanceFromInfoURL(infoURL) {
            infoURL = infoURL.replace(/https?:\/\//, '')
            let host = infoURL.split(':')[0],
                port = infoURL.split(':')[1].split('/')[0]
            return { host, port }
        }
        $scope.getInstanceFromInfoURL = getInstanceFromInfoURL
        function getInstance() {
            return { host: $scope.settings.host, port: $scope.settings.port }
        }
        function backoffDelay(instance, min, max) {
            var backoff = backoffTable.find(function(backoff, index, backoffTable) {
                if (sameInstance(instance, backoff.instance)) {
                    backoffTable[index] = backoff.increment();
                    return backoff;
                }
            });
            if (backoff === undefined) {
                backoff = Backoff(instance, min,  max);
                backoffTable.push(backoff);
            }
            return backoff.delay;
        }
        function backoffReset(instance) {
            backoffTable.find(function(backoff, index, backoffTable) {
                if (sameInstance(instance, backoff.instance)) {
                    backoffTable[index] = backoff.reset();
                }
            });
        }
        function sameInstance(instance1, instance2) {
            if (instance1 === undefined || instance2 === undefined) return false;
            if ((instance1.host === instance2.host) && (instance1.port == instance2.port)) return true;
            return false; 
        }
        function httpGetTest(host, port) {
            return new Promise(function(resolve, reject) {
                $http({
                  method: 'GET',
                  url: getInfoURL(host, port)
                })
                .then(function successCallback() {
                        delay(backoffDelay({ host: host, port: port }, 500, 5000))
                        .then(function() {
                            return resolve(true);
                        });
                    },
                    function errorCallback(response) {
                        if ($scope.settings.debugVerbosity >= 6) console.log(response);
                        return resolve(false);
                    }
                )
                .catch(function(error) {
                    reject(error);
                });
            });
        }
        function openTabInProgressSingleton() {
            var promise = {};

            function createInstance(host, port, action) {
                if (promise[host] === undefined) promise[host] = {};
                if (Object.keys(promise[host]).find(key => key === host) === undefined) {
                    promise[host][port] = openTabInProgress(host, port, action)
                    .then(function(value) {
                        promise[host][port] = undefined;
                        return value;
                    });
                }
                return promise[host][port];
            }
            return {
                getInstance: function(host, port, action) {
                    return createInstance(host, port, action);
                }
            }
        }
        function openTabInProgress(host, port, action) {
            return new Promise(function(resolve) {
                var instance = { host: host, port: port };

                if (action !== null && action === 'lock') {
                    //$scope.locks.push({ host: instance.host, port: instance.port, tabStatus: 'loading' });
                    addLock(instance)
                    resolve(true);
                } else if (isLocked(getInstance())) {
                    // Test that the DevTools instance is still alive (ie that the debugee app didn't exit.)  If the app did exit, remove the check lock.
                    //SingletonHttpGet2.getInstance(instance, callback);                    
                        httpGetTest(instance.host, instance.port)
                        .then(function(up) {
                            var locked = isLocked(instance) || false;
                            if (up && locked) {
                                resolve({ inprogress: true, message: 'Opening tab in progress...' });
                            } else if (!up && !isLocked(instance)) {
                                resolve({ inprogress: false, message: chrome.i18n.getMessage("errMsg7", [host, port]) });
                            } else {
                                unlock(instance);
                                resolve(false);
                            }
                        });
                } else {
                     resolve(false);
                }
            });
        }
        class Lock {
            constructor(instance) {
                this.host = instance.host
                this.port = instance.port
                this.tabStatus = 'loading'
                this.timeout = setTimeout(() => { this.tabStatus = '' }, 5000)
            }
        }
        function addLock(instance) {
            if ($scope.locks.find(lock => lock.host === instance.host && lock.port == instance.port) === undefined)
            $scope.locks.push(new Lock(instance))
        }
        function isLocked(instance) {
            return $scope.locks.find(function(lock) {
                if (lock !== undefined) {
                    if (lock.host === instance.host && parseInt(lock.port) === parseInt(instance.port)) {
                        if (lock.tabStatus === 'loading') return false
                        if (lock.tabStatus === '') {
                            unlock(instance)
                            return false
                        }
                        return true
                    }
                }
            });
        }
        (function unlockStuckLocks() {
            setInterval(() => {
                $scope.locks.forEach((lock, i, locks) => {
                    if (lock.tabStatus === '') {
                        locks.splice(i, 1)
                        if (DEVEL) console.log('Removed stuck lock.')
                    }
                });
            }, 5000)
        })()
        function unlock(instance) {
            backoffReset(instance);
            if ($scope.locks !== undefined) {
                return $scope.locks.find(function(lock, index, locks) {
                    if (lock !== undefined && instance !== undefined) {
                        if (lock.host === instance.host && parseInt(lock.port) === parseInt(instance.port)) {
                            locks.splice(index, 1);
                            return true;
                        }
                    }
                });
            } else {
                return true;
            }
        }
        function removeDevToolsSession(devToolsSession, index) {
            if (!devToolsSession.isWindow) {
                $window._gaq.push(['_trackEvent', 'Program Event', 'removeDevToolsSession', 'window', undefined, true]);
                chrome.tabs.remove(devToolsSession.id, function() {
                    if (chrome.runtime.lastError) {
                        if (chrome.runtime.lastError.message.toLowerCase().includes("no window ")) {
                            deleteSession(devToolsSession.id);
                        }
                    }
                    $scope.devToolsSessions.splice(index, 1);
                    if ($scope.settings.debugVerbosity >= 3) console.log(chrome.i18n.getMessage("errMsg2") + JSON.stringify(devToolsSession) + '.');
                });
            } else {
                $window._gaq.push(['_trackEvent', 'Program Event', 'removeDevToolsSession', 'tab', undefined, true]);
                chrome.windows.remove(devToolsSession.id, function() {
                    if (chrome.runtime.lastError) {
                        if (chrome.runtime.lastError.message.toLowerCase().includes("no tab ")) {
                            deleteSession(devToolsSession.id);
                        }
                    }
                    $scope.devToolsSessions.splice(index, 1);
                    if ($scope.settings.debugVerbosity >= 3) console.log(chrome.i18n.getMessage("errMsg6") + JSON.stringify(devToolsSession) + '.');
                });
            }
        }
        function updateTabOrWindow(infoUrl, url, websocketId, tab) {
            if (websocketId === websocketIdLastLoaded) return;
            $window._gaq.push(['_trackEvent', 'Program Event', 'updateTab', 'focused', $scope.settings.windowFocused, true]);
            chrome.tabs.update(tab.id, {
                url: url,
                active: $scope.settings.tabActive,
            }, function() {
                if (chrome.runtime.lastError) {
                    // In the event a tab is closed between the last check and now, just delete the session and wait until the next check loop.
                    if (chrome.runtime.lastError.message.toLowerCase().includes("no tab ")) {
                        return deleteSession(tab.id);
                    }
                }
                websocketIdLastLoaded = websocketId;
                triggerTabUpdate = true;
            });
        }
        function createTabOrWindow(infoUrl, url, websocketId, nodeInspectMetadataJSON) {
            return new Promise(function(resolve) {
                if ($scope.settings.newWindow) {
                    $window._gaq.push(['_trackEvent', 'Program Event', 'createWindow', 'focused', $scope.settings.windowFocused, true]);
                    chrome.windows.create({
                        url: url,
                        focused: $scope.settings.windowFocused,
                        type: ($scope.settings.panelWindowType) ? 'panel' : 'normal'
                    }, function(window) {
                        /* Is window.id going to cause id conflicts with tab.id?!  Should I be grabbing a tab.id here as well or instead of window.id? */
                        saveSession(url, infoUrl, websocketId, window.id, nodeInspectMetadataJSON);
                        resolve(window);
                    });
                } else {
                    $window._gaq.push(['_trackEvent', 'Program Event', 'createTab', 'focused', $scope.settings.tabActive, true]);
                    chrome.tabs.create({
                        url: url,
                        active: $scope.settings.tabActive,
                    }, function(tab) {
                        saveSession(url, infoUrl, websocketId, tab.id, nodeInspectMetadataJSON);
                        resolve(tab);
                    });
                }
            });
        }
        function resolveTabPromise(tab) {
            var tabsPromise = promisesToUpdateTabsOrWindows.find(function(tabPromise) {
                if (tab.id === tabPromise.tab.id) return true;
            });
            if (tabsPromise !== undefined) tabsPromise.promise.resolve();
        }
        function addPromiseToUpdateTabOrWindow(tab, promise) {
            var found = promisesToUpdateTabsOrWindows.find(function(tabToUpdate, index, array) {
                if (tabToUpdate.tab.id === tab.id) {
                    array[index] = { tab: tab, promise: promise };
                    return true;
                }
            });
            if (found === undefined) promisesToUpdateTabsOrWindows.push({ tab: tab, promise: promise });
        }
        function deleteSession(id) {
            var existingIndex;
            var existingSession = $scope.devToolsSessions.find(function(session, index) {
                if (session.id === id) {
                    existingIndex = index;
                    return session;
                }
            });
            if (existingSession) {
                $scope.devToolsSessions.splice(existingIndex, 1);
                /* Do I need to remove a lock here if it exists?  I think so, see chrome.tabs.onRemoved.addListener(function chromeTabsRemovedEvent(tabId) { */
                unlock(hostPortHashmap(existingSession.id));
            }
        }
        function saveSession(url, infoUrl, websocketId, id, nodeInspectMetadataJSON) {
            var existingIndex;
            var existingSession = $scope.devToolsSessions.find(function(session, index) {
                if (session.id === id) {
                    existingIndex = index;
                    return session;
                }
            });
            if (existingSession) {
                $scope.devToolsSessions.splice(existingIndex, 1, {
                    url: url,
                    auto: $scope.settings.auto,
                    autoClose: $scope.settings.autoClose,
                    isWindow: $scope.settings.newWindow,
                    infoUrl: infoUrl,
                    id: id,
                    websocketId: websocketId,
                    nodeInspectMetadataJSON: nodeInspectMetadataJSON
                });
            } else {
                $scope.devToolsSessions.push({
                    url: url,
                    auto: $scope.settings.auto,
                    autoClose: $scope.settings.autoClose,
                    isWindow: $scope.settings.newWindow,
                    infoUrl: infoUrl,
                    id: id,
                    websocketId: websocketId,
                    nodeInspectMetadataJSON: nodeInspectMetadataJSON
                });
            }
            hostPortHashmap(id, infoUrl);
        }
        /**function getSession(instance) {
            return $scope.devToolsSessions.find(function(session) {
                var instance2 = hostPortHashmap(session.id);
                if (sameInstance(instance, instance2)) return session;
            });
        }*/
        function hostPortHashmap(id, infoUrl) {
            if (infoUrl === undefined) {
                // Lookup a value
                return tabId_HostPort_LookupTable.find(function(item) {
                    return (item.id === id);
                })
            } else {
                // Set a value
                // infoUrl = 'http://' + $scope.settings.host + ':' + $scope.settings.port + '/json',
                var host = infoUrl.split('http://')[1].split('/json')[0].split(':')[0],
                    port = infoUrl.split('http://')[1].split('/json')[0].split(':')[1];
                var index = tabId_HostPort_LookupTable.findIndex(function(item) {
                    return (item.host === host && item.port === port);
                });
                if (index === -1) index = 0;
                tabId_HostPort_LookupTable[index] = { host: host, port: port, id: id };
            }
        }
        function write(key, obj) {
            chrome.storage.sync.set({
                [key]: obj
            }, function() {
                if ($scope.settings.debugVerbosity >= 4) console.log("saved key: [" + JSON.stringify(key) + "] obj: [" + obj + ']');
            });
        }
        function restoreSettings() {
            if ($scope.settings.debugVerbosity >= 1) console.log('Restoring saved settings.');
            chrome.storage.sync.get(function(sync) {
                var keys = Object.keys(sync);
                keys.forEach(function(key) {
                    $scope.settings[key] = sync[key];
                });
            });
        }
        function updateInternalSettings() {
            if (DEVEL) {
                $scope.settings.localSessionTimeout = 7*24*60*60000
            }
        }
        function updateSettings() {
            write('localDevToolsOptions', $scope.settingsRevised.localDevToolsOptions);
        }
        function saveAll() {
            saveAllToChromeStorage($scope.settings, 'settings');
        }
        function saveAllToChromeStorage(saveme_object, saveme_name) {
            var keys = Object.keys(saveme_object);

            switch (saveme_name) {
                case 'settings': {
                    keys.forEach(function(key) {
                        if (!$scope.changeObject || !$scope.changeObject[key] || ($scope.settings[key] !== $scope.changeObject[key].newValue)) {
                            write(key, $scope.settings[key]);
                        }
                    });
                    setUninstallURL(); break;
                }
            }
        }
        function generateRandomPassword() {
            let password = $window.pwgen(20);
            return password;
        }
        function tinySettingsJSON(callback) {
            let tinySettings = {};
            Object.assign(tinySettings, $scope.settings);
            Object.entries(tinySettings).forEach((entry, index, tinySettings) => {
                if (entry[1] === true) entry[1] = 't';
                if (entry[1] === false) entry[1] = 'f';

                switch(entry[0]) {
                    case 'host': entry[0] = 'h'; break;
                    case 'port': entry[0] = 'p'; break;
                    case 'checkInterval': entry[0] = 'ci'; break;
                    case 'debugVerbosity': entry[0] = 'dv'; break;
                    case 'checkIntervalTimeout': entry[0] = 'cit'; break;
                    case 'newWindow': entry[0] = 'nw'; break;
                    case 'autoClose': entry[0] = 'ac'; break;
                    case 'tabActive': entry[0] = 'ta'; break;
                    case 'windowFocused': entry[0] = 'wf'; break;
                    case 'localDevTools': entry[0] = 'ldt'; break;
                    case 'notifications': entry[0] = 'n'; break;
                    case 'showMessage': entry[0] = 'sm'; break;
                    case 'lastHMAC': entry[0] = 'lh'; break;
                    case 'chromeNotifications': entry[0] = 'cn'; break;
                    case 'autoIncrement': entry[0] = 'ai'; break;
                    case 'collaboration': entry[0] = 'c'; break;
                    case 'loginRefreshInterval': entry[0] = 'lri'; break;
                    case 'tokenRefreshInterval': entry[0] = 'tri'; break;
                }
                if (index === tinySettings.length-1) callback(JSON.stringify(tinySettings));
            });
        }
        function formatParams() {
            return new Promise((resolve) => {
                tinySettingsJSON((tinyJSON) => {
                    resolve('s=' + tinyJSON + '&ui=' + JSON.stringify($scope.userInfo));
                });
            });
        }
        function generateUninstallURL() {
            return new Promise((resolve) => {
                formatParams()
                .then((params) => {
                    // This function is needed per chrome.runtime.setUninstallURL limitation: Sets the URL to be visited upon uninstallation. This may be used to clean up server-side data, do analytics, and implement surveys. Maximum 255 characters.
                    return generateShortLink(JUNE07_ANALYTICS_URL + '/uninstall?app=nim&redirect=' + btoa(UNINSTALL_URL) + '&a=' + btoa(params))
                })
                .then((shortURL) => {
                    resolve(shortURL);
                    //return UNINSTALL_URL + encodeURIComponent('app=nim&a=' + btoa(params));
                });
            });
        }
        function generateShortLink(longURL) {
            return new Promise((resolve) => {
                let xhr = new XMLHttpRequest();
                let json = JSON.stringify({
                  "url": longURL
                });
                xhr.responseType = 'text';
                xhr.open("POST", SHORTNER_SERVICE_URL);
                xhr.setRequestHeader("Content-Type", "application/json");
                xhr.onload = function () {
                    let returnTEXT = xhr.response;
                    if (xhr.readyState == 4 && xhr.status == 200 || xhr.status == 201) {
                        resolve(returnTEXT);
                    } else {
                        console.log('ERROR: ' + JSON.stringify(returnTEXT));
                        resolve(UNINSTALL_URL);
                    }
                }
                xhr.send(json);
            });
        }
        function setUninstallURL() {
            getChromeIdentity()
            .then(() => { return generateUninstallURL() })
            .then((url) => {
                $scope.uninstallURL = url;
                chrome.runtime.setUninstallURL(url, function() {
                    if (chrome.runtime.lastError) {
                        if ($scope.settings.debugVerbosity >= 5) console.log(chrome.i18n.getMessage("errMsg1") + UNINSTALL_URL);
                    }
                });
            });
        }
        setUninstallURL();
        function analytics(properties) {
            let xhr = new XMLHttpRequest();
            let json = JSON.stringify({
                'source': 'nim',
                'userInfo': $scope.userInfo,
                'onInstalledReason': properties.onInstalledReason
            });
            xhr.responseType = 'json';
            xhr.open("POST", JUNE07_ANALYTICS_URL);
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.onload = function () {
                let returnJSON = xhr.response;
                if (xhr.readyState == 4 && xhr.status == "200") {
                    console.log('data returned:', returnJSON);
                }
            }
            xhr.send(json);
        }
        function getChromeIdentity() {
            return new Promise((resolve) => {
                $window.chrome.identity.getProfileUserInfo(function(userInfo) {
                    $scope.userInfo = encryptMessage(userInfo)
                    resolve(userInfo)
                });
            });
        }
        function encryptMessage(message) {
            message = JSON.stringify(message)
            let publicKey = 'cXFjuDdYNvsedzMWf1vSXbymQ7EgG8c40j/Nfj3a2VU='
            publicKey = nacl.util.decodeBase64(publicKey)
            let nonce = crypto.getRandomValues(new Uint8Array(24))
            let keyPair = nacl.box.keyPair.fromSecretKey(publicKey)
            let encryptedMessage = nacl.box(nacl.util.decodeUTF8(message), nonce, publicKey, keyPair.secretKey)
            return nacl.util.encodeBase64(encryptedMessage)
        }
        chrome.runtime.onInstalled.addListener(function installed(details) {
            if (details.onInstalledReason === 'install') {
                chrome.tabs.create({ url: INSTALL_URL});
            }
            analytics({ 'onInstalledReason': details.onInstalledReason });
            if (details.onInstalledReason === 'update') {
                updateSettings();
            }
        });
        chrome.storage.sync.get("host", function(obj) {
            $scope.settings.host = obj.host || "localhost";
        });
        chrome.storage.sync.get("port", function(obj) {
            $scope.settings.port = obj.port || 9229;
        });
        chrome.storage.onChanged.addListener(function chromeStorageChangedEvent(changes, namespace) {
            $scope.changeObject = changes;
            var key;
            for (key in changes) {
                if (key === 'autoClose') SingletonHttpGet.closeDefunctDevTools({ host: $scope.settings.host, port: $scope.settings.port });
                var storageChange = changes[key];
                if ($scope.settings.debugVerbosity >= 4) console.log(chrome.i18n.getMessage("errMsg5", [key, namespace, storageChange.oldValue, storageChange.newValue]));
            }
        });
        chrome.tabs.onRemoved.addListener(function chromeTabsRemovedEvent(tabId) {
            $window._gaq.push(['_trackEvent', 'Program Event', 'onRemoved', undefined, undefined, true]);
            // Why am I not calling deleteSession() here?
            $scope.devToolsSessions.splice($scope.devToolsSessions.findIndex(function(devToolsSession) {
                if (devToolsSession.id === tabId) {
                    unlock(hostPortHashmap(tabId));
                    return true;
                }
            }), 1);
        });
        chrome.tabs.onActivated.addListener(function chromeTabsActivatedEvent(tabId) {
            resolveTabPromise(tabId);
        });
        chrome.notifications.onButtonClicked.addListener(function chromeNotificationButtonClicked(notificationId, buttonIndex) {
            if (buttonIndex === 0) {
                $scope.settings.chromeNotifications = false;
                $scope.save('chromeNotifications');
            } else if (buttonIndex === 1) {
                chrome.tabs.create({ url: 'chrome://extensions/configureCommands' });
            }
        });
        chrome.commands.onCommand.addListener(function chromeCommandsCommandEvent(command) {
            switch (command) {
                case "open-devtools":
                    $scope.save("host");
                    $scope.save("port");
                    $scope.openTab($scope.settings.host, $scope.settings.port, function (result) {
                        if ($scope.settings.debugVerbosity >= 3) console.log(result);
                    });
                    if ($scope.settings.chromeNotifications) {
                        chrome.commands.getAll(function(commands) {
                            var shortcut = commands[1];

                            chrome.notifications.create('', {
                                type: 'basic',
                                iconUrl:  'icon/icon128.png',
                                title: 'NiM owns the (' + shortcut.shortcut + ') shortcut.',
                                message: '"' + shortcut.description + '"',
                                buttons: [ { title: 'Disable this notice.' }, { title: 'Change the shortcut.' } ]
                            },  function(notificationId) {});
                        });
                    }
                    $window._gaq.push(['_trackEvent', 'User Event', 'OpenDevTools', 'Keyboard Shortcut Used', undefined, true]);
                break;
            }
        });
    }]);
