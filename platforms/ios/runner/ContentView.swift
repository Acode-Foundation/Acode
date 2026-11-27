//
//  ContentView.swift
//  acode
//
//  Created by Ajit Kumar on 07/04/26.
//

import SwiftUI

struct ContentView: View {
    var body: some View {
        WebViewControllerRepresentable()
            .ignoresSafeArea()
    }
}

struct WebViewControllerRepresentable: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebViewController {
        WebViewController()
    }

    func updateUIViewController(_ uiViewController: WebViewController, context: Context) {}
}
