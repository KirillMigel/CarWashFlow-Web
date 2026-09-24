import SwiftUI

@main
struct CarWashWebViewApp: App {
    var body: some Scene {
        WindowGroup {
            WebContainerView()
                .ignoresSafeArea()
                .statusBarHidden(true)
        }
    }
}

