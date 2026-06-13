#import "SystemPlugin.h"
#import <UIKit/UIKit.h>
#import <objc/runtime.h>

@interface SystemPlugin ()
- (void)dispatchCommand:(CDVInvokedUrlCommand*)command forSelector:(NSString*)selectorName;
@end

static void SystemPluginDispatch(id self, SEL _cmd, CDVInvokedUrlCommand* command) {
    NSString* selectorName = NSStringFromSelector(_cmd);
    [(SystemPlugin*)self dispatchCommand:command forSelector:selectorName];
}

@implementation SystemPlugin

+ (BOOL)resolveInstanceMethod:(SEL)sel {
    NSString* methodName = NSStringFromSelector(sel);
    if ([methodName containsString:@"-"]) {
        class_addMethod(self, sel, (IMP)SystemPluginDispatch, "v@:@");
        return YES;
    }
    return [super resolveInstanceMethod:sel];
}

- (void)dispatchCommand:(CDVInvokedUrlCommand*)command forSelector:(NSString*)selectorName {
    NSString* methodName = [selectorName substringToIndex:selectorName.length - 1];

    // P0: Real implementations
    if ([methodName isEqualToString:@"set-ui-theme"]) {
        [self handleSetUiTheme:command];
    } else if ([methodName isEqualToString:@"open-in-browser"]) {
        [self handleOpenInBrowser:command];
    } else if ([methodName isEqualToString:@"set-input-type"]) {
        [self sendEmptyStringTo:command];
    } else if ([methodName isEqualToString:@"set-native-context-menu-disabled"]) {
        [self sendEmptyStringTo:command];
    }
    // Hyphenated stubs
    else if ([methodName isEqualToString:@"get-webkit-info"]) {
        [self sendEmptyDictTo:command];
    } else if ([methodName isEqualToString:@"is-powersave-mode"]) {
        [self sendFalseTo:command];
    } else if ([methodName isEqualToString:@"file-action"]) {
        [self sendError:@"Not supported on iOS" toCommand:command];
    } else if ([methodName isEqualToString:@"get-app-info"]) {
        [self sendEmptyDictTo:command];
    } else if ([methodName isEqualToString:@"add-shortcut"]) {
        [self sendEmptyStringTo:command];
    } else if ([methodName isEqualToString:@"remove-shortcut"]) {
        [self sendEmptyStringTo:command];
    } else if ([methodName isEqualToString:@"pin-shortcut"]) {
        [self sendEmptyStringTo:command];
    } else if ([methodName isEqualToString:@"pin-file-shortcut"]) {
        [self sendEmptyStringTo:command];
    } else if ([methodName isEqualToString:@"manage-all-files"]) {
        [self sendFalseTo:command];
    } else if ([methodName isEqualToString:@"get-android-version"]) {
        [self sendInt:(0) toCommand:command];
    } else if ([methodName isEqualToString:@"is-external-storage-manager"]) {
        [self sendFalseTo:command];
    } else if ([methodName isEqualToString:@"request-permission"]) {
        [self sendTrueTo:command];
    } else if ([methodName isEqualToString:@"request-permissions"]) {
        [self sendEmptyDictTo:command];
    } else if ([methodName isEqualToString:@"has-permission"]) {
        [self sendTrueTo:command];
    } else if ([methodName isEqualToString:@"launch-app"]) {
        [self sendError:@"Not supported on iOS" toCommand:command];
    } else if ([methodName isEqualToString:@"in-app-browser"]) {
        [self sendError:@"Not supported on iOS" toCommand:command];
    } else if ([methodName isEqualToString:@"set-intent-handler"]) {
        [self sendEmptyStringTo:command];
    } else if ([methodName isEqualToString:@"get-cordova-intent"]) {
        [self sendEmptyDictTo:command];
    } else if ([methodName isEqualToString:@"get-global-setting"]) {
        [self sendEmptyStringTo:command];
    } else if ([methodName isEqualToString:@"compare-file-text"]) {
        [self sendInt:0 toCommand:command];
    } else if ([methodName isEqualToString:@"compare-texts"]) {
        [self sendInt:0 toCommand:command];
    }
}

// P0: Real implementations

- (void)handleSetUiTheme:(CDVInvokedUrlCommand*)command {
    NSString* colorHex = [command.arguments objectAtIndex:0];
    if (![colorHex isKindOfClass:[NSString class]]) {
        [self sendError:@"Missing color argument" toCommand:command];
        return;
    }

    dispatch_async(dispatch_get_main_queue(), ^{
        if (![colorHex hasPrefix:@"#"]) {
            [self sendEmptyStringTo:command];
            return;
        }

        NSString* theme = @"dark";
        if (command.arguments.count > 1 && [[command.arguments objectAtIndex:1] isKindOfClass:[NSString class]]) {
            theme = [command.arguments objectAtIndex:1];
        }

        if ([theme isEqualToString:@"light"]) {
            [UINavigationBar appearance].barStyle = UIBarStyleDefault;
        } else {
            [UINavigationBar appearance].barStyle = UIBarStyleBlack;
        }

        [self sendEmptyStringTo:command];
    });
}

- (void)handleOpenInBrowser:(CDVInvokedUrlCommand*)command {
    NSString* urlStr = [command.arguments objectAtIndex:0];
    if (![urlStr isKindOfClass:[NSString class]]) {
        [self sendError:@"Invalid URL" toCommand:command];
        return;
    }
    NSURL* url = [NSURL URLWithString:urlStr];
    if (!url) {
        [self sendError:@"Invalid URL" toCommand:command];
        return;
    }
    dispatch_async(dispatch_get_main_queue(), ^{
        [UIApplication.sharedApplication openURL:url options:@{} completionHandler:nil];
        [self sendEmptyStringTo:command];
    });
}

// Public methods

- (void)setUiTheme:(CDVInvokedUrlCommand*)command {
    [self handleSetUiTheme:command];
}

- (void)openInBrowser:(CDVInvokedUrlCommand*)command {
    [self handleOpenInBrowser:command];
}

- (void)getInstaller:(CDVInvokedUrlCommand*)command {
    [self sendString:@"com.apple.appstore" toCommand:command];
}

- (void)getFilesDir:(CDVInvokedUrlCommand*)command {
    NSArray* paths = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES);
    [self sendString:(paths.firstObject ?: @"") toCommand:command];
}

// MARK: - Stubs with camelCase selectors

- (void)isManageExternalStorageDeclared:(CDVInvokedUrlCommand*)command {
    [self sendFalseTo:command];
}
- (void)hasGrantedStorageManager:(CDVInvokedUrlCommand*)command {
    [self sendFalseTo:command];
}
- (void)requestStorageManager:(CDVInvokedUrlCommand*)command {
    [self sendFalseTo:command];
}
- (void)copyToUri:(CDVInvokedUrlCommand*)command {
    [self sendError:@"Not supported on iOS" toCommand:command];
}
- (void)fileExists:(CDVInvokedUrlCommand*)command {
    [self sendFalseTo:command];
}
- (void)createSymlink:(CDVInvokedUrlCommand*)command {
    [self sendError:@"Not supported on iOS" toCommand:command];
}
- (void)writeText:(CDVInvokedUrlCommand*)command {
    [self sendError:@"Not supported on iOS" toCommand:command];
}
- (void)deleteFile:(CDVInvokedUrlCommand*)command {
    [self sendError:@"Not supported on iOS" toCommand:command];
}
- (void)setExec:(CDVInvokedUrlCommand*)command {
    [self sendError:@"Not supported on iOS" toCommand:command];
}
- (void)shareText:(CDVInvokedUrlCommand*)command {
    [self sendError:@"Not supported on iOS" toCommand:command];
}
- (void)getNativeLibraryPath:(CDVInvokedUrlCommand*)command {
    [self sendEmptyStringTo:command];
}
- (void)getRewardStatus:(CDVInvokedUrlCommand*)command {
    [self sendFalseTo:command];
}
- (void)redeemReward:(CDVInvokedUrlCommand*)command {
    [self sendFalseTo:command];
}
- (void)getParentPath:(CDVInvokedUrlCommand*)command {
    [self sendEmptyStringTo:command];
}
- (void)listChildren:(CDVInvokedUrlCommand*)command {
    [self sendArray:@[] toCommand:command];
}
- (void)mkdirs:(CDVInvokedUrlCommand*)command {
    [self sendFalseTo:command];
}
- (void)getArch:(CDVInvokedUrlCommand*)command {
    [self sendString:@"arm64" toCommand:command];
}
- (void)clearCache:(CDVInvokedUrlCommand*)command {
    [self sendEmptyStringTo:command];
}

// MARK: - Typed helpers

- (void)sendString:(NSString*)str toCommand:(CDVInvokedUrlCommand*)command {
    CDVPluginResult* result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsString:str];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)sendEmptyStringTo:(CDVInvokedUrlCommand*)command {
    CDVPluginResult* result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsString:@""];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)sendTrueTo:(CDVInvokedUrlCommand*)command {
    CDVPluginResult* result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsBool:YES];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)sendFalseTo:(CDVInvokedUrlCommand*)command {
    CDVPluginResult* result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsBool:NO];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)sendInt:(int)value toCommand:(CDVInvokedUrlCommand*)command {
    CDVPluginResult* result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsInt:value];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)sendArray:(NSArray*)arr toCommand:(CDVInvokedUrlCommand*)command {
    CDVPluginResult* result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsArray:arr];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)sendEmptyDictTo:(CDVInvokedUrlCommand*)command {
    CDVPluginResult* result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:@{}];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (void)sendError:(NSString*)message toCommand:(CDVInvokedUrlCommand*)command {
    CDVPluginResult* result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:message];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

@end
