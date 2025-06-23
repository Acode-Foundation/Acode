/*
The MIT License (MIT)

Copyright (c) 2019 Mikihiro Hayashi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

#import "CDVBuildInfo.h"
#import <Cordova/CDV.h>

#import <mach/mach_time.h>

@implementation CDVBuildInfo

CDVPluginResult* _cachePluginResult = nil;

static mach_timebase_info_data_t sTimebaseInfo;

void _BuildInfo_reportProfileProcessTime(const uint64_t start, const NSString *text) {
	
	uint64_t elapsedNano = (mach_absolute_time() - start) * sTimebaseInfo.numer / sTimebaseInfo.denom;
	
	NSLog(@"BuildInfo init: %.4f sec(%llu nsec): %@", elapsedNano / 1000000000.0, elapsedNano, text);
}

const NSString* _BuildInfo_GetDictionaryValue(const NSDictionary *dict, const NSString *key, const NSString *defaultValue) {

    const NSString *value = dict[key];
    
	if (!value) {
        value = defaultValue;
    }

    return value;
}

/* init */
- (void)init:(CDVInvokedUrlCommand*)command
{
	// init mach_timebase
	if (sTimebaseInfo.denom == 0) {
		mach_timebase_info(&sTimebaseInfo);
	}
	
	// Method start time.
	uint64_t profilrStart = mach_absolute_time();
	
	// Cache
	if (nil != _cachePluginResult) {
		[self.commandDelegate sendPluginResult:_cachePluginResult callbackId:command.callbackId];
		_BuildInfo_reportProfileProcessTime(profilrStart, @"Cache data return");
		return;
	}
	
	
	NSBundle* bundle = [NSBundle mainBundle];
	NSDictionary* info = [bundle infoDictionary];
#ifdef DEBUG
	NSNumber* debug = [NSNumber numberWithBool:YES];
#else
	NSNumber* debug = [NSNumber numberWithBool:NO];
#endif
	
	//NSString *buildDate = @"";
	NSString *installDate = @"";
	
	NSDateFormatter *dfRFC3339 = [[NSDateFormatter alloc] init];
	[dfRFC3339 setDateFormat:@"yyyy-MM-dd'T'HH:mm:ssZZZZZ"];
	
	// config.xml modification date
    NSString *path = [bundle pathForResource:@"config.xml" ofType:nil];
    if (path) {
		NSDictionary<NSFileAttributeKey, id>* attr = [[NSFileManager defaultManager] attributesOfItemAtPath:path error:nil];
		NSDate* modificationDate = [attr objectForKey:NSFileModificationDate];
		
		if (modificationDate) {
			//buildDate = [dfRFC3339 stringFromDate:modificationDate];
		}
    }
	
    // app date added
    NSString *pathBundle = [bundle bundlePath];
    if (pathBundle) {
        NSURL *urlBundle = [NSURL fileURLWithPath:pathBundle];
        
        MDItemRef itemRef = MDItemCreateWithURL(kCFAllocatorDefault, (CFURLRef)urlBundle);
        if (itemRef) {
            CFTypeRef typeRef = MDItemCopyAttribute(itemRef, kMDItemDateAdded);
            if (typeRef && CFGetTypeID(typeRef) == CFDateGetTypeID()) {
                NSDate *dateAdded = (__bridge NSDate*)typeRef;
                installDate = [dfRFC3339 stringFromDate:dateAdded];
            }
            CFRelease(typeRef);
        }
        CFRelease(itemRef);
    }
	
    const NSString *bundleName = _BuildInfo_GetDictionaryValue(info, @"CFBundleName", @"");
    
	NSDictionary* result = @{
							 @"packageName"    : [bundle bundleIdentifier],
							 @"basePackageName": [bundle bundleIdentifier],
                             @"displayName"    : _BuildInfo_GetDictionaryValue(info, @"CFBundleDisplayName", bundleName),
							 @"name"           : bundleName,
							 @"version"        : _BuildInfo_GetDictionaryValue(info, @"CFBundleShortVersionString", @""),
							 @"versionCode"    : _BuildInfo_GetDictionaryValue(info, @"CFBundleVersion", @""),
							 @"debug"          : debug,
							 //@"buildDate"      : buildDate,
							 @"installDate"    : installDate,
							 @"buildType"      : @"", // Android Only
							 @"flavor"         : @""  // Android Only*/
						};

	if ([debug boolValue]) {
		NSLog(@"BuildInfo packageName    : \"%@\"", [result objectForKey:@"packageName"]);
		NSLog(@"BuildInfo basePackageName: \"%@\"", [result objectForKey:@"basePackageName"]);
		NSLog(@"BuildInfo displayName    : \"%@\"", [result objectForKey:@"displayName"]);
		NSLog(@"BuildInfo name           : \"%@\"", [result objectForKey:@"name"]);
		NSLog(@"BuildInfo version        : \"%@\"", [result objectForKey:@"version"]);
		NSLog(@"BuildInfo versionCode    : \"%@\"", [result objectForKey:@"versionCode"]);
		NSLog(@"BuildInfo debug          : %@"    , [[result objectForKey:@"debug"] boolValue] ? @"YES" : @"NO");
		NSLog(@"BuildInfo buildType      : \"%@\"", [result objectForKey:@"buildType"]);
		//NSLog(@"BuildInfo buildDate      : \"%@\"", [result objectForKey:@"buildDate"]);
		NSLog(@"BuildInfo installDate    : \"%@\"", [result objectForKey:@"installDate"]);
		NSLog(@"BuildInfo flavor         : \"%@\"", [result objectForKey:@"flavor"]);
	}

	CDVPluginResult* pluginResult = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:result];
	
	// Reulst cache
	if (nil == _cachePluginResult) {
		_cachePluginResult = pluginResult;
	}

	[self.commandDelegate sendPluginResult:pluginResult callbackId:command.callbackId];
	_BuildInfo_reportProfileProcessTime(profilrStart, @"Return");
}

@end
