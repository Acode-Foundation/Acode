import groovy.json.JsonSlurper
import java.io.File

plugins {
    alias(libs.plugins.android.application)
}

val acode = file("../../../package.json").parseJsonObject()
val ads = file("../../../ads.json").parseJsonObject().jsonObject("android")!!
val selectedEdition = mapOf(
    "com.foxdebug.acode" to "paid",
    "com.foxdebug.acodefree" to "free"
)[acode["androidPackageId"] as String]
    ?: throw GradleException("Set package.json androidPackageId to com.foxdebug.acode (paid) or com.foxdebug.acodefree (free).")

android {
    //this is not package name do not change
    namespace = "com.foxdebug.acode"
    compileSdk = 37
    buildToolsVersion = "36.0.0"
    defaultConfig {
        minSdk = 26
        targetSdk = 37
        versionCode = (acode["versionCode"] as Number).toInt()
        versionName = acode["version"] as String
    }
    flavorDimensions += listOf("edition", "channel")
    productFlavors {
        create("paid") {
            dimension = "edition"
            applicationId = "com.foxdebug.acode"
        }
        create("free") {
            dimension = "edition"
            applicationId = "com.foxdebug.acodefree"
        }
        create("store") {
            dimension = "channel"
            buildConfigField("boolean", "FDROID", "false")
        }
        create("fdroid") {
            dimension = "channel"
            targetSdk = 28
            buildConfigField("boolean", "FDROID", "true")
        }
    }
    buildFeatures {
        buildConfig = true
        resValues = true
    }
    signingConfigs {
        create("release")
        val configFile = file("../../../build.json")
        if (configFile.exists()) {
            val signingConfigurations = configFile.parseJsonObject().jsonObject("android")
            listOf("debug", "release").forEach { type ->
                val config = signingConfigurations?.jsonObject(type) ?: return@forEach
                val keystore = config["keystore"] as? String ?: return@forEach
                getByName(type) {
                    storeFile = if (File(keystore).isAbsolute) file(keystore) else file("../../../$keystore")
                    storePassword = config["storePassword"] as? String
                    keyAlias = config["alias"] as? String
                    keyPassword = config["password"] as? String
                    (config["keystoreType"] as? String)?.let { storeType = it }
                }
            }
        }
    }
    buildTypes {
        getByName("debug") {
            isDebuggable = true
            manifestPlaceholders["admobAppId"] = ads.jsonObject("test")!!["appId"] as String
        }
        getByName("release") {
            manifestPlaceholders["admobAppId"] = ads.jsonObject("production")!!["appId"] as String
            isMinifyEnabled = true
            isShrinkResources = true
            if (signingConfigs.getByName("release").storeFile != null) {
                signingConfig = signingConfigs.getByName("release")
            }
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
        resources {
            pickFirsts += "META-INF/versions/9/OSGI-INF/MANIFEST.MF"
        }
    }
    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

configurations.configureEach {
    exclude(module = "commons-logging")
    exclude(group = "org.bouncycastle", module = "bcprov-jdk15on")
    exclude(group = "org.bouncycastle", module = "bcpkix-jdk15on")
    exclude(group = "org.bouncycastle", module = "bcpkix-jdk18on")
    exclude(group = "org.bouncycastle", module = "bcprov-jdk18on")
}

dependencies {
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.core)
    implementation(libs.androidx.core.google.shortcuts)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.documentfile)
    implementation(libs.androidx.security.crypto)
    implementation(libs.androidx.webkit)
    implementation(libs.bouncycastle.bcpkix)
    implementation(libs.bouncycastle.bcprov)
    implementation(libs.commons.codec)
    implementation(libs.commons.io)
    implementation(libs.commons.net)
    implementation(libs.java.websocket)
    implementation(libs.maverick.synergy.client)
    implementation(libs.nanohttpd)
    implementation(libs.okhttp)

    //check product flavours
    "freeImplementation"(libs.play.services.ads)
    "freeImplementation"(libs.user.messaging.platform)
    "storeImplementation"(libs.billing.client)
    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
}

androidComponents {
    beforeVariants(selector().all()) { variant ->
        variant.enable = variant.productFlavors.first { it.first == "edition" }.second == selectedEdition
    }
}

@Suppress("UNCHECKED_CAST")
fun File.parseJsonObject(): Map<String, Any> = JsonSlurper().parse(this) as Map<String, Any>

@Suppress("UNCHECKED_CAST")
fun Map<String, Any>.jsonObject(key: String): Map<String, Any>? = this[key] as? Map<String, Any>
