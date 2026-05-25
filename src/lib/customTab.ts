import helpers from "utils/helpers";

/**
 * Open custom tab
 */
export default function customTab(
  url: string,
  options?: {
    showTitle?: boolean;
    toolbarColor?: string;
  },
) {
  if (!options) {
    options = {};
  }

  options.showTitle ??= true;

  return new Promise((resolve, reject) => {
    cordova.exec(resolve, reject, "CustomTabs", "open", [url, options]);
  });
}
