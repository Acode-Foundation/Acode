# Keep Cordova classes
-keep class org.apache.cordova.** { *; }

# Cordova discovers plugins by class name from config.xml and instantiates them
# reflectively, and plugins can dispatch actions by method name through
# reflection too (e.g. Ftp.execute() uses
# getClass().getDeclaredMethod(action, JSONArray, CallbackContext)).
# Without keeping the members, R8 strips methods such as connect()/listDirectory()
# and those plugin calls fail at runtime with NoSuchMethodException.
-keep public class * extends org.apache.cordova.CordovaPlugin { *; }

# WebView JS bridge methods are invoked by name from JavaScript.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# cordova-plugin-buildinfo resolves the app's BuildConfig reflectively:
# Class.forName(packageName + ".BuildConfig") and c.getField(fieldName).
-keep class **.BuildConfig { *; }

# maverick-synergy (SSH/SFTP) references java.lang.management from
# Utils.generateThreadDump(), which does not exist on Android. That method is
# never reached on Android, so ignore the missing Java SE classes.
-dontwarn java.lang.management.**

# Keep Javascript Interface attributes
-keepattributes *Annotation*,EnclosingMethod,InnerClasses,Signature
