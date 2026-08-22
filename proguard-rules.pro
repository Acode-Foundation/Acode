# Keep Cordova's reflection-loaded bridge and Acode's native plugin code stable.
-keep class org.apache.cordova.** { *; }
-keep class com.foxdebug.** { *; }
-keep class com.silkimen.** { *; }
-keep class com.verso.** { *; }
-keep class admob.plus.** { *; }

# SSH and crypto providers perform runtime discovery and reflective registration.
-keep class com.sshtools.** { *; }
-keep class org.bouncycastle.** { *; }

# Maverick's optional desktop thread-dump diagnostic references JMX. Android
# does not ship these classes, and Acode never enables maverick.threadDump.
-dontwarn java.lang.management.ManagementFactory
-dontwarn java.lang.management.ThreadInfo
-dontwarn java.lang.management.ThreadMXBean

# cordova-plugin-buildinfo loads the active variant's BuildConfig by name.
-keep class **.BuildConfig { *; }

-keepattributes RuntimeVisibleAnnotations,RuntimeInvisibleAnnotations,AnnotationDefault
-keepattributes Signature,Exceptions,InnerClasses,EnclosingMethod
