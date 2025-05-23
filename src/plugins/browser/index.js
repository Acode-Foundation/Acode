import settings from 'lib/settings';
import themes from 'theme/list';

const SERVICE = 'Browser';

function open(url, isConsole = false) {
  console.log("opening "+url)
  const ACTION = 'open';
  const success = () => { };
  const error = () => { };
  const theme = themes.get(settings.value.appTheme).toJSON('hex');
  cordova.exec(success, error, SERVICE, ACTION, [url, theme, isConsole]);
}

export default {
  open,
};