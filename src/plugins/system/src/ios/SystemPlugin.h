#import <Cordova/CDVPlugin.h>

@interface SystemPlugin : CDVPlugin

- (void)setUiTheme:(CDVInvokedUrlCommand*)command;
- (void)openInBrowser:(CDVInvokedUrlCommand*)command;

@end
