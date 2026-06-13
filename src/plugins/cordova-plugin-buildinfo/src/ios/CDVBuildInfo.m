#import "CDVBuildInfo.h"

@implementation CDVBuildInfo

- (void)init:(CDVInvokedUrlCommand*)command
{
    NSDictionary* info = [[NSBundle mainBundle] infoDictionary];

    BOOL isDebug =
#ifdef DEBUG
        YES;
#else
        NO;
#endif

    NSString* packageName = [info objectForKey:@"CFBundleIdentifier"] ?: @"";
    NSString* displayName = [info objectForKey:@"CFBundleDisplayName"]
        ?: [info objectForKey:@"CFBundleName"]
        ?: @"";
    NSString* version = [info objectForKey:@"CFBundleShortVersionString"] ?: @"";
    // CFBundleVersion is the build number (monotonically increasing integer)
    id bundleVersion = [info objectForKey:@"CFBundleVersion"];
    NSInteger versionCode = 0;
    if ([bundleVersion isKindOfClass:[NSString class]]) {
        versionCode = [(NSString*)bundleVersion integerValue];
    } else if ([bundleVersion isKindOfClass:[NSNumber class]]) {
        versionCode = [(NSNumber*)bundleVersion integerValue];
    }

    // Get install date from the creation date of the Documents directory
    NSString* installDateStr = @"";
    NSArray* paths = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES);
    if (paths.count > 0) {
        NSDictionary* attrs = [[NSFileManager defaultManager] attributesOfItemAtPath:paths[0] error:nil];
        NSDate* creationDate = attrs[NSFileCreationDate];
        if (creationDate) {
            NSDateFormatter* formatter = [[NSDateFormatter alloc] init];
            formatter.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
            formatter.dateFormat = @"yyyy-MM-dd'T'HH:mm:ss.SSS'Z'";
            formatter.timeZone = [NSTimeZone timeZoneForSecondsFromGMT:0];
            installDateStr = [formatter stringFromDate:creationDate];
        }
    }

    NSDictionary* resultDict = @{
        @"packageName": packageName,
        @"basePackageName": packageName,
        @"displayName": displayName,
        @"name": displayName,
        @"version": version,
        @"versionCode": @(versionCode),
        @"debug": @(isDebug),
        @"buildType": isDebug ? @"debug" : @"release",
        @"flavor": @"",
        @"installDate": installDateStr
    };

    CDVPluginResult* result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK
                                            messageAsDictionary:resultDict];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

@end
