// We run on the default port on device.
const isDevice = location.port === "";

window.config = {
  isDevice,
  port: isDevice ? 80 : 8081,
};

function addLink(url) {
  let link = document.createElement("link");
  link.setAttribute("rel", "stylesheet");
  link.setAttribute("href", url);
  document.head.appendChild(link);
  return link;
}

function loadScript(url, defer = false) {
  let script = document.createElement("script");
  script.setAttribute("src", url);
  if (defer) {
    script.setAttribute("defer", "true");
  }
  document.head.appendChild(script);
  return script;
}

function loadSharedScript(url) {
  return loadScript(`http://shared.localhost:${location.port}/${url}`);
}

// Load <link rel="stylesheet" href="style/{device|desktop}.css" />
addLink(`/style/${isDevice ? "device" : "desktop"}.css`);

let depGraphLoaded = new Promise((resolve) => {
  loadSharedScript("js/dep_graph.js").onload = resolve;
});

// Load the "Readex Pro" font
addLink(`http://shared.localhost:${location.port}/style/fonts.css`);
