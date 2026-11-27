//
//  AcodeApp.swift
//  acode
//
//  Created by Ajit Kumar on 07/04/26.
//

import SwiftUI
import UserNotifications

class AppDelegate: NSObject, UIApplicationDelegate {
    static weak var shared: AppDelegate?
    var fullscreenOrientation: UIInterfaceOrientationMask?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        AppDelegate.shared = self
        UNUserNotificationCenter.current().delegate = NotificationService.shared
        return true
    }

    @available(iOS, deprecated: 26.0, message: "Migrate to UIScene lifecycle when targeting iOS 26+")
    func application(
        _ app: UIApplication,
        open url: URL,
        options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    ) -> Bool {
        IncomingLinks.shared.receive(url)
        return true
    }

    func application(
        _ application: UIApplication,
        supportedInterfaceOrientationsFor window: UIWindow?
    ) -> UIInterfaceOrientationMask {
        fullscreenOrientation ?? (UIDevice.current.userInterfaceIdiom == .pad ? .all : .allButUpsideDown)
    }
}

@main
struct AcodeApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
                .ignoresSafeArea()
                .onOpenURL { IncomingLinks.shared.receive($0) }
        }
    }
}
