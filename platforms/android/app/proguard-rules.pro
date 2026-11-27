# Keep Acode classes
-keep class com.foxdebug.acode.runtime.** { *; }

# Services are registered by type in ServiceRegistry, but a few of them dispatch
# actions by method name through reflection (e.g. Ftp.execute() uses
# getClass().getDeclaredMethod(action, JSONArray, Callback)).
# Without keeping the members, R8 strips methods such as connect()/listDirectory()
# and those calls fail at runtime with NoSuchMethodException.
-keep public class * extends com.foxdebug.acode.runtime.Service { *; }

# WebView JS bridge methods are invoked by name from JavaScript.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# BuildInfo resolves the app BuildConfig and its fields reflectively.
-keep class **.BuildConfig { *; }

# maverick-synergy (SSH/SFTP) references java.lang.management from
# Utils.generateThreadDump(), which does not exist on Android. That method is
# never reached on Android, so ignore the missing Java SE classes.
-dontwarn java.lang.management.**

# Keep Javascript Interface attributes
-keepattributes *Annotation*,EnclosingMethod,InnerClasses,Signature
