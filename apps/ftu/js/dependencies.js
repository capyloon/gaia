const kDeps = [
  {
    name: "intro",
    kind: "virtual",
    deps: ["shoelace-button", "shoelace-drawer", "shoelace-light-theme"],
  },
  {
    name: "shoelace-light-theme",
    kind: "sharedStyle",
    param: "shoelace/themes/light.css",
  },
  {
    name: "shoelace-dark-theme",
    kind: "sharedStyle",
    param: "shoelace/themes/dark.css",
  },
  {
    name: "language-panel",
    kind: "virtual",
    deps: [
      "shoelace-menu",
      "shoelace-menu-item",
      "shoelace-icon",
      "language-module",
    ],
  },
  { name: "language-module", kind: "module", param: "js/language_panel.js" },
  {
    name: "wifi-panel",
    kind: "virtual",
    deps: [
      "shoelace-menu",
      "shoelace-menu-item",
      "shoelace-icon",
      "shoelace-switch",
      "shoelace-divider",
      "shoelace-dialog",
      "shoelace-input",
    ],
  },
  {
    name: "display-panel",
    kind: "virtual",
    deps: ["shoelace-icon", "shoelace-switch", "display-module"],
  },
  { name: "display-module", kind: "module", param: "js/display_panel.js" },
];
