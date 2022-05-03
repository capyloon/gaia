// Manages a window loading some web content

// Duration of the display of navigation shortcut, in ms.
const kNavigationDisplayDuration = 1500;
// Duration of the app swipe lock when the page is being scrolled, in ms.
const kSwipeLockDuration = 500;

// Helper class to manager process priorities transitions.
class ProcessManager {
  constructor() {
    this.service = window.apiDaemon.getProcManager();
  }

  setForeground(pid) {
    console.log(`ProcessManager: setForeground ${pid}`);
    this.service.then((procmanager) => {
      let lib = window.lib_procmanager;
      procmanager
        .begin("systemapp")
        .then(() => procmanager.add(pid, lib.GroupType.FOREGROUND))
        .then(() => procmanager.commit())
        .catch((error) => {
          console.error(
            `ProcessManager: Failed to switch ${pid} to foreground: ${error}`
          );
        });
    });
  }

  setBackground(pid, tryToKeep = false) {
    console.log(`ProcessManager: setBackground ${pid} keep=${tryToKeep}`);
    this.service.then((procmanager) => {
      let lib = window.lib_procmanager;
      let backgroundType = tryToKeep
        ? lib.GroupType.TRY_TO_KEEP
        : lib.GroupType.BACKGROUND;
      procmanager
        .begin("systemapp")
        .then(() => procmanager.add(pid, backgroundType))
        .then(() => procmanager.commit())
        .catch((error) => {
          console.error(
            `ProcessManager: Failed to switch ${pid} to background: ${error}`
          );
        });
    });
  }

  remove(pid) {
    console.log(`ProcessManager: remove ${pid}`);
    this.service.then((procmanager) => {
      let lib = window.lib_procmanager;
      procmanager
        .begin("systemapp")
        .then(() => procmanager.remove(pid))
        .then(() => procmanager.commit())
        .catch((error) => {
          console.error(`ProcessManager: Failed to remove ${pid}: ${error}`);
        });
    });
  }

  moveToForeground(newFg, oldFg, tryToKeep) {
    this.service.then((procmanager) => {
      let lib = window.lib_procmanager;
      let backgroundType = tryToKeep
        ? lib.GroupType.TRY_TO_KEEP
        : lib.GroupType.BACKGROUND;
      procmanager
        .begin("systemapp")
        .then(() => procmanager.add(newFg, lib.GroupType.FOREGROUND))
        .then(() => procmanager.add(oldFg, backgroundType))
        .then(() => procmanager.commit())
        .catch((error) => {
          console.error(
            `Failed to switch foreground / background app: ${error}`
          );
        });
    });
  }

  whenKilled(killedPid, newFg) {
    this.service.then((procmanager) => {
      let lib = window.lib_procmanager;
      procmanager
        .begin("systemapp")
        .then(() => procmanager.add(newFg, lib.GroupType.FOREGROUND))
        .then(() => procmanager.remove(killedPid))
        .then(() => procmanager.commit())
        .catch((error) => {
          console.error(`Failed to kill app: ${error}`);
        });
    });
  }
}

window.processManager = new ProcessManager();

const kSiteInfoEvents = [
  "zoom-in",
  "zoom-out",
  "nav-back",
  "nav-forward",
  "nav-reload",
  "change-ua",
  "toggle-reader-mode",
];

class ContentWindow extends HTMLElement {
  constructor() {
    super();

    // Initial state used to sync the UI state with this web-view state.
    this.state = {
      url: "",
      title: "",
      secure: "insecure",
      icon: "",
      manifestUrl: "",
      iconSize: 0,
      canGoBack: false,
      canGoForward: false,
      isHomescreen: false,
      bringAttention: false,
    };

    // No configuration available yet.
    this.config = null;

    // By default, a new content window is not activated.
    this.activated = false;

    // Track the keyboard state, to re-open it if needed when switching back
    // to a frame with a focused element.
    this.keyboardOpen = false;
  }

  addSiteInfoListeners() {
    let siteInfo = document.querySelector("site-info");
    kSiteInfoEvents.forEach((event) => siteInfo.addEventListener(event, this));
  }

  removeSiteInfoListeners() {
    let siteInfo = document.querySelector("site-info");
    kSiteInfoEvents.forEach((event) =>
      siteInfo.removeEventListener(event, this)
    );
  }

  setConfig(config) {
    this.config = config;
    this.state.id = config.id;
    this.state.isHomescreen = config.isHomescreen;
    this.state.fromLockscreen = config.fromLockscreen;
    this.state.whenClosed = config.whenClosed;
    if (!config.isHomescreen) {
      this.classList.add("not-homescreen");
    }
  }

  disableContentBlocking(shouldReload = true) {
    try {
      modules.ContentBlockingAllowList.add(this.webView.linkedBrowser);
      if (shouldReload) {
        this.webView.reload();
      }
    } catch (e) {
      console.log(`XXX oopss ${e}`);
    }
  }

  enableContentBlocking(shouldReload = true) {
    try {
      modules.ContentBlockingAllowList.remove(this.webView.linkedBrowser);
      if (shouldReload) {
        this.webView.reload();
      }
    } catch (e) {
      console.log(`XXX oopss ${e}`);
    }
  }

  // Handles various events from the content-window UI and
  // from the site-info panel.
  handleEvent(event) {
    switch (event.type) {
      case "zoom-in":
        this.zoomIn();
        break;
      case "zoom-out":
        this.zoomOut();
        break;
      case "nav-back":
        this.webView.goBack();
        break;
      case "nav-forward":
        this.webView.goForward();
        break;
      case "nav-reload":
        this.reload();
        break;
      case "toggle-reader-mode":
        this.webView.toggleReaderMode();
        break;
      case "change-ua":
        this.webView.linkedBrowser.browsingContext.customUserAgent =
          UAHelper.get(event.detail);
        this.webView.reload();
        break;
    }
  }

  connectedCallback() {
    if (!this.config) {
      console.error(
        "ContentWindow::setConfig() needs to be called before connectedCallback()"
      );
      return;
    }

    let src = this.config.startUrl || "about:blank";
    let transparent = this.config.isHomescreen ? "transparent=true" : "";

    let remoteType = "web";
    if (this.config.isPrivilegedExtension) {
      remoteType = "extension";
    }

    let browsingContextGroupIdAttr = "";
    if (this.config.browsingContextGroupId) {
      browsingContextGroupIdAttr = `browsingContextGroupId="${this.config.browsingContextGroupId}"`;
    }

    let container = document.createElement("div");
    container.classList.add("container");
    container.innerHTML = `
      <link rel="stylesheet" href="components/content_window.css">
      <web-view remote="true" remoteType="${remoteType}" ${browsingContextGroupIdAttr} ${transparent}></web-view>
      <div class="loader running">
        <sl-icon name="loader"></sl-icon>
        <img class="hidden"/>
        <div class="title hidden"></div>
      </div>
      <div class="content-crash hidden">
        <sl-alert variant="danger" open>
          <sl-icon slot="icon" name="skull"></sl-icon>
          <div class="message" data-l10n-id="content-crashed"></div>
          <sl-button variant="primary" class="reload-button" data-l10n-id="content-reload"></sl-button>
        </sl-alert>
      </div>
      <div class="select-ui hidden"><select-ui></select-ui></div>
      <div class="navigation hidden">
        <sl-icon id="scroll-top" name="chevron-up"></sl-icon>
        <sl-icon id="scroll-bottom" name="chevron-down"></sl-icon>
      </div>
      <div class="overscroll hidden">
        <sl-icon name="refresh-cw"></sl-icon>
      </div>
      `;

    this.container = container;
    this.appendChild(container);
    this.webView = this.querySelector("web-view");
    this.webView.openWindowInfo = this.config.openWindowInfo || null;
    this.webView.src = src;

    this.loader = this.querySelector(".loader");
    this.contentCrash = this.querySelector(".content-crash");
    this.selectUiContainer = this.querySelector(".select-ui");

    this.querySelector("#scroll-top").onclick = this.scrollToTop.bind(this);
    this.querySelector("#scroll-bottom").onclick =
      this.scrollToBottom.bind(this);
    this.navigation = this.querySelector(".navigation");
    this.navigationTimer = null;
    this.swipeLockTimer = null;

    this.pid = this.webView.processid;

    this.webViewHandler = this.handleBrowserEvent.bind(this);

    this.overscrollHandler = this.handleOverscrollEvent.bind(this);
    this.overscrollContainer = this.querySelector(".overscroll");

    if (this.config.details) {
      let { backgroundColor, icon, title } = this.config.details;
      if (backgroundColor) {
        this.loader.style.backgroundColor = backgroundColor;
      }
      if (icon) {
        this.loader.classList.remove("running");
        this.loader.querySelector("sl-icon").classList.add("hidden");
        let img = this.loader.querySelector("img");
        img.classList.remove("hidden");
        img.src = icon;
      }
      if (title) {
        let text = this.loader.querySelector(".title");
        text.classList.remove("hidden");
        text.textContent = title;
        if (backgroundColor) {
          text.style.color = backgroundColor;
        }
      }

      this.state.search = this.config.details.search;
    }

    // If loading about:blank, no need for a loader.
    if (src === "about:blank") {
      this.loader.classList.remove("running");
      this.loader.classList.add("hidden");
      this.state.secure = "secure";
    }

    // Attaching all event listeners.
    this.webViewEvents = [
      "close",
      "contextmenu",
      "documentfirstpaint",
      "error",
      "iconchange",
      "loadstart",
      "loadend",
      "locationchange",
      "manifestchange",
      "metachange",
      "opensearch",
      "processready",
      "promptpermission",
      "readermodestate",
      "scroll",
      "securitychange",
      "titlechange",
      "visibilitychange",
    ];

    this.initWebView();
    embedder.delayPreallocatedProcess();

    this.openKeyboard = () => {
      if (this.activated) {
        // Only change the size of the current window.
        this.classList.add("keyboard-open");
        this.keyboardOpen = true;
      } else {
        console.error(
          `Trying to open the keyboard on non-active frame ${this.webView.currentURI}`
        );
      }
    };

    this.closeKeyboard = () => {
      this.classList.remove("keyboard-open");
      this.keyboardOpen = false;
    };

    this.navigateTo = (_name, url) => {
      this.webView.src = url;
    };

    actionsDispatcher.addListener("ime-focus-changed", (_name, data) => {
      if (this.activated) {
        this.keyboardData = data;
      }
    });

    // Unmute sound for the content channel.
    this.webView.allowedAudioChannels.forEach(async (channel) => {
      if (channel.name === "content") {
        await channel.setVolume(1);
        await channel.setMuted(false);
      }
    });
  }

  initWebView() {
    this.webViewEvents.forEach((eventName) => {
      this.webView.addEventListener(eventName, this.webViewHandler);
    });

    // Preserve layers even for inactive docShells
    this.webView.linkedBrowser.preserveLayers(true);

    this.mediaController = this.webView.mediaController;
    [
      "activated",
      "deactivated",
      "metadatachange",
      "playbackstatechange",
      "positionstatechange",
      "supportedkeyschange",
    ].forEach((name) => {
      this.mediaController.addEventListener(name, async (event) => {
        // console.log(
        //   `MediaController: ${event.type}, state=${
        //     this.mediaController.playbackState
        //   } title=${this.mediaController.getMetadata().title}`
        // );

        // When the media starts playing or when the metadata changes and
        // the media is playing, update a Media resource in the content index.
        if (
          (event.type === "metadatachange" ||
            event.type === "playbackstatechange") &&
          this.mediaController.playbackState === "playing"
        ) {
          let meta = this.mediaController.getMetadata();
          if (this.ogImage) {
            meta.ogImage = this.ogImage;
          }
          meta.backgroundColor = this.state.backgroundColor;
          await contentManager.createOrUpdateMediaEntry(
            this.state.url,
            this.state.icon,
            meta
          );
        }
      });
    });

    // Overscroll management.
    if (!this.config.isHomescreen) {
      ["overscroll-start", "overscroll-end"].forEach((eventName) => {
        embedder.addEventListener(eventName, this.overscrollHandler);
      });
      this.overscrollTimer = null;
    }
  }

  uninitWebView() {
    this.webViewEvents.forEach((eventName) => {
      this.webView.removeEventListener(eventName, this.webViewHandler);
    });

    if (!this.config.isHomescreen) {
      ["overscroll-start", "overscroll-end"].forEach((eventName) => {
        embedder.removeEventListener(eventName, this.overscrollHandler);
      });
      if (this.overscrollTimer) {
        window.clearTimeout(this.overscrollTimer);
      }
    }
  }

  handleOverscrollEvent(event) {
    if (!this.activated) {
      return;
    }

    // console.log(`Overscroll event: ${event.type} on ${this.config.startUrl}`);
    if (event.type === "overscroll-start") {
      this.overscrollContainer.classList.remove("hidden");
      this.overscrollContainer.classList.remove("will-reload");
      this.overscrollReloadNeeded = false;
      // Start the overscroll timer.
      if (this.overscrollTimer) {
        window.clearTimeout(this.overscrollTimer);
      }
      this.overscrollTimer = window.setTimeout(() => {
        this.overscrollReloadNeeded = true;
        this.overscrollContainer.classList.add("will-reload");
      }, 1500);
    } else {
      this.overscrollContainer.classList.add("hidden");
      this.overscrollContainer.classList.remove("will-reload");
      if (this.overscrollTimer) {
        window.clearTimeout(this.overscrollTimer);
      }
      if (this.overscrollReloadNeeded) {
        this.reload();
      }
    }
  }

  // Replaces the current <web-view> by a fresh new one, in
  // case of a crash.
  recreate() {
    this.uninitWebView();
    let webView = document.createElement("web-view");
    webView.setAttribute("remote", "true");
    if (this.config.isHomescreen) {
      webView.setAttribute("transparent", "true");
    }
    webView.setAttribute("src", this.config.startUrl);
    this.webView.replaceWith(webView);
    this.webView = webView;
    this.webView.openWindowInfo = this.config.openWindowInfo || null;

    this.initWebView();
  }

  cleanup() {
    this.webView.cleanup();
  }

  disconnectedCallback() {
    if (this.pid != -1) {
      processManager.remove(this.pid);
    }

    this.uninitWebView();
    this.removeSiteInfoListeners();
  }

  scrollToTop() {
    this.webView?.scrollToTop();
  }

  scrollToBottom() {
    this.webView?.scrollToBottom();
  }

  zoomIn() {
    if (!this.activated) {
      return;
    }
    let currentZoom = this.webView.fullZoom;
    let newZoom = Math.round(currentZoom * 11) / 10;
    this.webView.fullZoom = newZoom;
    this.dispatchStateUpdate();
  }

  zoomOut() {
    if (!this.activated) {
      return;
    }
    let currentZoom = this.webView.fullZoom;
    let newZoom = Math.round((10 * currentZoom) / 1.1) / 10;
    this.webView.fullZoom = newZoom;
    this.dispatchStateUpdate();
  }

  zoomReset() {
    if (!this.activated) {
      return;
    }
    this.webView.fullZoom = 1.0;
    this.dispatchStateUpdate();
  }

  focus() {
    this.webView.focus();
  }

  activate() {
    if (this.activated) {
      return;
    }

    // Always activate immediately, and cancel deactivation timer
    // if there is one running.
    if (this.deactivateTimer) {
      window.clearTimeout(this.deactivateTimer);
      this.deactivateTimer = null;
    }

    this.activated = true;
    this.addSiteInfoListeners();

    this.webView.active = true;
    this.focus();
    if (this.pid != -1) {
      processManager.setForeground(this.pid);
    }

    this.dispatchStateUpdate();

    actionsDispatcher.addListener("keyboard-opening", this.openKeyboard);
    actionsDispatcher.addListener("keyboard-closing", this.closeKeyboard);
    actionsDispatcher.addListener("navigate-to", this.navigateTo);

    if (this.keyboardOpen) {
      actionsDispatcher.dispatch("ime-focus-changed", this.keyboardData);
    }

    // Reset navigation timers and state.
    this.navigation.classList.add("hidden");
    if (this.navigationTimer) {
      window.clearTimeout(this.navigationTimer);
    }

    if (this.swipeLockTimer) {
      window.clearTimeout(this.swipeLockTimer);
    }
  }

  deactivate() {
    if (!this.activated) {
      return;
    }

    this.activated = false;
    this.removeSiteInfoListeners();

    actionsDispatcher.removeListener("keyboard-opening", this.openKeyboard);
    actionsDispatcher.removeListener("keyboard-closing", this.closeKeyboard);
    actionsDispatcher.removeListener("navigate-to", this.navigateTo);

    // Delay deactivation by 2s to prevent rapid switches.
    // if a timer is already running, we don't restart it.
    if (this.deactivateTimer) {
      return;
    }

    this.deactivateTimer = window.setTimeout(
      () => {
        this.deactivateTimer = null;
        this.webView.active = false;
        if (this.pid != -1) {
          processManager.setBackground(this.pid, this.config.isHomescreen);
        }
      },
      this.config.isHomescreen ? 3000 : 0
    );
  }

  dispatchStateUpdate() {
    if (!this.activated) {
      return;
    }

    this.state.zoom = this.webView.fullZoom;
    this.state.splitScreen = this.classList.contains("split");
    actionsDispatcher.dispatch("update-page-state", this.state);
  }

  async updateUi(placesUpdateNeeded) {
    if (!this.activated) {
      return;
    }

    this.dispatchStateUpdate();

    if (this.config.isHomescreen || this.state.url === "") {
      return;
    }

    if (placesUpdateNeeded) {
      await contentManager.createOrUpdatePlacesEntry(
        this.state.url,
        this.state.title,
        this.state.icon
      );
    }
  }

  goTo(url) {
    this.webView.src = url;
  }

  goBack() {
    this.webView.goBack();
  }

  goForward() {
    this.webView.goForward();
  }

  reload() {
    this.webView.reload();
  }

  themeColorChanged(color) {
    // console.log(`ContentWindow: themecolorchanged is ${color}`);
    let x = document.createElement("div");
    document.body.appendChild(x);
    try {
      x.style = `color: ${color} !important`;
      this.gotTheme = true;
      this.state.backgroundColor = window.getComputedStyle(x).color;
      this.dispatchStateUpdate();
    } catch (e) {}
    x.parentNode.removeChild(x);
  }

  async handleBrowserEvent(event) {
    let detail = event.detail;
    let uiUpdateNeeded = false;
    let placesUpdateNeeded = false;

    let eventType = event.type;

    switch (eventType) {
      case "documentfirstpaint":
        this.loader.classList.remove("running");
        this.loader.classList.add("hidden");
        if (this.config.isHomescreen) {
          actionsDispatcher.dispatch("homescreen-ready");
        }
        this.updateScreenshot();
        break;
      case "titlechange":
        this.state.title = detail.title;
        uiUpdateNeeded = true;
        placesUpdateNeeded = true;
        break;
      case "securitychange":
        this.state.secure = detail.state;
        uiUpdateNeeded = true;
        break;
      case "scroll":
        if (this.navigationTimer) {
          window.clearTimeout(this.navigationTimer);
        }

        if (this.swipeLockTimer) {
          window.clearTimeout(this.swipeLockTimer);
        } else {
          // Lock app switch when we scroll.
          window.wm.lockSwipe();
        }

        this.swipeLockTimer = window.setTimeout(() => {
          // Unlock app switch when we are done scrolling.
          window.wm.unlockSwipe();
          this.swipeLockTimer = null;
        }, kSwipeLockDuration);

        // Force the navigation pane to show up and cancel
        // running animations if any.
        this.navigationAnimation?.cancel();
        this.navigation.classList.remove("hidden");

        this.navigationTimer = window.setTimeout(() => {
          // Scrolling stabilized, time to take a screenshot.
          this.updateScreenshot();
          this.navigationAnimation = this.navigation.animate(
            [
              { opacity: 1, transform: "scale(1.0)" },
              { opacity: 0, transform: "scale(0.8)" },
            ],
            800
          );
          this.navigationAnimation.finished.then(() => {
            this.navigation.classList.add("hidden");
          });
          this.navigationTimer = null;
        }, kNavigationDisplayDuration);

        break;
      case "locationchange":
        this.ogImage = null;

        if (this.config.isHomescreen) {
          // Side channel to communicate with the homescreen...
          let url = new URL(detail.url);
          let hash = url.hash;
          if (hash === "#lock") {
            window.wm.lockSwipe();
          } else if (hash === "#unlock") {
            window.wm.unlockSwipe();
          }
        }

        // console.log(`locationchange ${this.state.url} -> ${detail.url}`);
        // We don't reset the icon url until we get a new one.
        this.state.iconSize = 0;
        this.state.canGoBack = detail.canGoBack;
        this.state.canGoForward = detail.canGoForward;

        // Only reset the theme status when this is a location change with a different origin + path,
        // not when it's changed eg. by replaceState()
        try {
          let oldUrl = new URL(this.state.url);
          let newUrl = new URL(detail.url);
          if (
            `${oldUrl.origin}${oldUrl.pathname}` !==
            `${newUrl.origin}${newUrl.pathname}`
          ) {
            this.gotTheme = false;
          }
        } catch (e) {
          console.error(`locationchange: ${e}`);
        }

        this.state.url = detail.url;
        uiUpdateNeeded = true;
        placesUpdateNeeded = true;
        break;
      case "visibilitychange":
        uiUpdateNeeded = true;
        break;
      case "metachange":
        if (detail.name == "theme-color") {
          this.themeColorChanged(detail.content);
        }
        if (detail.name == "og:image") {
          this.ogImage = detail.content;
        }
        break;
      case "loadend":
        if (!this.gotTheme) {
          this.webView
            .getBackgroundColor()
            .then(async (color) => {
              // Check again if we didn't race with a theme-color meta change.
              if (!this.gotTheme) {
                this.state.backgroundColor = color;
                await this.updateUi(true);
              }
            })
            .catch(async (error) => {
              console.error(`getBackground failed: ${error}`);
              await this.updateUi(true);
            });
        }
        break;
      case "iconchange":
        await this.iconchanged(detail);
        break;
      case "processready":
        this.pid = detail.processid;
        break;
      case "manifestchange":
        if (!this.state.bringAttention) {
          this.state.bringAttention = this.state.manifestUrl !== detail.href;
        }
        this.state.manifestUrl = detail.href;
        uiUpdateNeeded = true;
        break;
      case "contextmenu":
        if (detail && !this.config.isHomescreen) {
          console.log(`Got ContextMenu event detail=${JSON.stringify(detail)}`);
          detail.pageUrl = this.state.url;
          let menu = document.body.querySelector("context-menu");
          menu.open(detail, this);
        }
        break;
      case "close":
        if (this.state.fromLockscreen && this.state.whenClosed) {
          await this.state.whenClosed();
        }
        window.wm.closeFrame(
          this.getAttribute("id"),
          this.config.previousFrame
        );
        break;
      case "error":
        console.error(
          `YYY WebView error: type=${detail.type} reason=${detail.reason} [${this.state.url}]`
        );
        // If the homescreen crashed, wait a bit and reload it.
        if (detail.type === "fatal" && this.config.isHomescreen) {
          window.setTimeout(() => {
            this.recreate();
          }, 3000);
        } else if (detail.type === "fatal") {
          // Content crash, display the dialog that allows reloading.
          this.contentCrash.classList.remove("hidden");
          this.contentCrash.querySelector(".reload-button").addEventListener(
            "click",
            () => {
              // Reloading the crashed content.
              this.loader.classList.add("running");
              this.loader.classList.remove("hidden");
              this.contentCrash.classList.add("hidden");
              this.recreate();
            },
            { once: true }
          );
        } else if (detail.type === "offline") {
          this.loader.classList.remove("running");
          this.loader.classList.add("hidden");
        }
        break;
      case "promptpermission":
        console.log(
          `PPP permission prompt request for ${
            this.state.url
          }: ${JSON.stringify(detail)}`
        );
        // Example of geolocation request from Google Maps:
        // {
        //   requestAction:"prompt",
        //   permissions: {
        //     geolocation: {
        //       action: "prompt",
        //       options:[]
        //     }
        //   },
        //   requestId: "permission-prompt-{79d5952e-6174-4475-8f5a-7fbd577241c3}",
        //   origin:"https://www.google.com"
        //  }

        // Example of webrtc permission prompt from whereby.com:
        // {
        //   "requestAction": "prompt",
        //   "permissions": {
        //     "audio-capture": { "action": "prompt", "options": ["default"] },
        //     "video-capture": { "action": "prompt", "options": ["front", "back"] }
        //   },
        //   "requestId": "permission-prompt-{88c6cb76-f250-4747-ad1b-8a06b906286a}",
        //   "origin": "https://whereby.com"
        // }
        if (detail.requestAction === "prompt") {
          // For permissions that have options, choose the first one.
          let choices = {};
          for (let permName in detail.permissions) {
            let permission = detail.permissions[permName];
            if (permission.options.length > 0) {
              choices[permName] = permission.options[0];
            }
          }

          let answer = {
            origin: detail.origin,
            granted: true,
            remember: true,
            choices,
          };
          console.log(`PPP answer: ${JSON.stringify(answer)}`);
          this.webView.dispatchEvent(
            new CustomEvent(detail.requestId, { detail: answer })
          );
        }
        break;
      case "readermodestate":
        this.state.readerMode = detail;
        uiUpdateNeeded = true;
        break;
      case "opensearch":
        this.maybeAddOpenSearch(detail.href);
        break;
      default:
        console.error(
          `${event.type} ============ for ${
            this.webView.currentURI || "about:blank"
          } : ${JSON.stringify(detail)}`
        );
        break;
    }

    if (uiUpdateNeeded || placesUpdateNeeded) {
      await this.updateUi(placesUpdateNeeded);
      if (!this.config.isHomescreen && eventType === "locationchange") {
        await contentManager.visitPlace(this.state.url);
      }
    }
  }

  // Register an opensearch provider if it's not known yet.
  async maybeAddOpenSearch(url) {
    if (!this.openSearchManager) {
      this.openSearchManager = contentManager.getOpenSearchManager();
      await this.openSearchManager.init();
    }

    if (!this.openSearchManager.hasEngine(url)) {
      await this.openSearchManager.addFromUrl(
        url,
        false,
        null,
        this.state.icon
      );
    }
  }

  // Update the url of the icon, trying to use the "best" one.
  async iconchanged(data) {
    let max_size = this.state.iconSize;
    let rel = data.rel || "icon";
    let found = false;

    rel.split(" ").forEach((rel) => {
      let size = 0;
      if (rel == "icon" || rel == "shortcut") {
        size = 32;
      }

      if (rel == "apple-touch-icon" || rel == "apple-touch-icon-precomposed") {
        // Default size according to https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html
        size = 57;
      }

      // If there is a `sizes` property, trust it.
      if (data.sizes === "any") {
        // Scalable icon, can't beat that!
        this.state.icon = data.href;
        this.state.iconSize = 1000000;
        found = true;
        return;
      }

      if (data.sizes) {
        data.sizes
          .toLowerCase()
          .split(" ")
          .forEach((item) => {
            let width = item.split("x")[0];
            if (width > size) {
              size = width;
              this.state.icon = data.href;
            }
          });
      }

      if (size > max_size) {
        max_size = size;
        found = true;
        this.state.icon = data.href;
        this.state.iconSize = size;
      }
    });

    // We have a new icon, update the UI state.
    if (found) {
      await this.updateUi(true);
    }
  }

  updateScreenshot() {
    if (this.config.isHomescreen) {
      // No need to take screenshots of the homescreen since it doesn't
      // appear in the carousel view.
      return Promise.resolve(new Blob());
    }

    // We are already waiting for a screenshot, bail out.
    if (this.screenshotId) {
      return Promise.resolve(new Blob());
    }

    return new Promise((resolve) => {
      this.screenshotId = window.requestIdleCallback(() => {
        let start = Date.now();
        let mimeType = this.config.isHomescreen ? "image/png" : "image/jpeg";
        this.webView
          .getScreenshot(window.innerWidth, window.innerHeight, mimeType)
          .then((blob) => {
            this.screenshotId = null;
            console.log(`Got screenshot: ${blob} in ${Date.now() - start}ms`);
            this.screenshot = blob;
            resolve(blob);
          });
      });
    });
  }

  // Returns the current screenshot if any, and a promise resolving to an updated one.
  getScreenshot() {
    if (this.config.isHomescreen) {
      console.error(`getScreenShot() called for the homescreen!`);
      return { current: null, next: Promise.resolve(new Blob()) };
    }

    return { current: this.screenshot, next: this.updateScreenshot() };
  }

  // Show the <select> UI as a tab-modal component.
  async showSelectUI(data) {
    // console.log(`ContentWindow: <select> ${JSON.stringify(data)}`);
    let ui = this.selectUiContainer.firstElementChild;
    ui.onclose = () => {
      ui.reset();
      this.selectUiContainer.classList.add("hidden");
    };
    ui.setData(data);
    this.selectUiContainer.classList.remove("hidden");
  }

  // TODO: That code should move to web-view.js in Gecko.
  savePage() {
    let scope = {};
    Services.scriptloader.loadSubScript(
      "chrome://global/content/contentAreaUtils.js",
      scope
    );
    scope.saveBrowser(this.webView.linkedBrowser, true /* skipPrompt */);
  }

  // TODO: That code should move to web-view.js in Gecko.
  async saveAsPDF() {
    const { DownloadPaths } = ChromeUtils.import(
      "resource://gre/modules/DownloadPaths.jsm"
    );
    const { OS } = ChromeUtils.import("resource://gre/modules/osfile.jsm");

    let linkedBrowser = this.webView.linkedBrowser;
    let filename = "";
    if (linkedBrowser.contentTitle != "") {
      filename = linkedBrowser.contentTitle;
    } else {
      let url = new URL(linkedBrowser.currentURI.spec);
      let path = decodeURIComponent(url.pathname);
      path = path.replace(/\/$/, "");
      filename = path.split("/").pop();
      if (filename == "") {
        filename = url.hostname;
      }
    }
    filename = `${DownloadPaths.sanitize(filename)}.pdf`;

    // Create a unique filename for the temporary PDF file
    const basePath = OS.Path.join(OS.Constants.Path.tmpDir, filename);
    const { file, path: filePath } = await OS.File.openUnique(basePath);
    await file.close();

    let psService = Cc["@mozilla.org/gfx/printsettings-service;1"].getService(
      Ci.nsIPrintSettingsService
    );
    const printSettings = psService.newPrintSettings;
    printSettings.isInitializedFromPrinter = true;
    printSettings.isInitializedFromPrefs = true;
    printSettings.outputFormat = Ci.nsIPrintSettings.kOutputFormatPDF;
    printSettings.printerName = "";
    printSettings.printSilent = true;
    printSettings.outputDestination =
      Ci.nsIPrintSettings.kOutputDestinationFile;
    printSettings.toFileName = filePath;

    let title = await window.utils.l10n("save-as-pdf-title");
    let body = await window.utils.l10n("save-as-pdf-processing", { filename });
    let tag = `notif-save-pdf-${filename}`;
    let _notif = new Notification(title, { body, tag, data: { progress: -1 } });

    linkedBrowser.browsingContext
      .print(printSettings)
      .then(async () => {
        actionsDispatcher.dispatch("import-download", filePath);
        let body = await window.utils.l10n("save-as-pdf-done", { filename });
        let _notif = new Notification(title, { body, tag });
        window.toaster.show(body);
      })
      .catch(async (e) => {
        let body = await window.utils.l10n("save-as-pdf-error", { filename });
        let _notif = new Notification(title, { body, tag });
        window.toaster.show(body, "danger");
      });
  }
}

customElements.define("content-window", ContentWindow);
