import XCTest

final class KnowledgeBallUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments += ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20), "The packaged WKWebView did not start")
    }

    func testPackagedWebParitySmoke() throws {
        let webView = app.webViews.firstMatch
        XCTAssertTrue(webView.staticTexts["KNOWLEDGE BALL"].waitForExistence(timeout: 15), "Web shell is blank")

        // A canvas in the live WKWebView proves that the Web-owned Three.js surface mounted.
        XCTAssertTrue(webView.otherElements.matching(identifier: "canvasHost").firstMatch.exists || webView.descendants(matching: .any).count > 10,
                      "The WebGL scene did not expose a populated accessibility tree")

        let settings = webView.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Settings' OR label CONTAINS '设置'")).firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout: 10), "Settings is not visible")
        settings.tap()
        XCTAssertTrue(webView.staticTexts.matching(NSPredicate(format: "label == 'Settings' OR label == '设置'")).firstMatch.waitForExistence(timeout: 5))

        let language = webView.staticTexts.matching(NSPredicate(format: "label == 'Language' OR label == '语言'")).firstMatch
        XCTAssertTrue(language.exists, "Language control is missing")
        let locale = webView.popUpButtons.firstMatch
        XCTAssertTrue(locale.exists, "Language selector is not tappable")
        locale.tap()
        let picker = app.pickerWheels.firstMatch
        if picker.waitForExistence(timeout: 2) {
            picker.adjust(toPickerWheelValue: "English")
            app.buttons["Done"].tap()
        } else {
            let english = app.buttons["English"]
            XCTAssertTrue(english.waitForExistence(timeout: 2), "English locale option is missing")
            english.tap()
        }
        XCTAssertTrue(webView.staticTexts["Language"].waitForExistence(timeout: 5), "Language switch did not update Web UI")
        webView.buttons.matching(NSPredicate(format: "label CONTAINS '❌' OR label CONTAINS[c] 'Close'")).firstMatch.tap()

        let search = webView.textFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5), "Search input is missing")
        search.tap()
        search.typeText("gravity")
        XCTAssertEqual(search.value as? String, "gravity")

        // Exercise a real scene node through its Web-owned label rather than a native route.
        let node = webView.staticTexts["质数的定义"]
        XCTAssertTrue(node.waitForExistence(timeout: 15), "The seeded 3D node labels did not render")
        node.tap()
        XCTAssertTrue(webView.buttons.matching(NSPredicate(format: "label CONTAINS '❌' OR label CONTAINS[c] 'Close'")).firstMatch.waitForExistence(timeout: 5),
                      "A scene node did not open its detail panel")

        let add = webView.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Add knowledge' OR label CONTAINS '新增知识'")).firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 5), "The node-detail create action is missing")
        add.tap()
        let submit = webView.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Submit' OR label CONTAINS '提交'")).firstMatch
        XCTAssertTrue(submit.waitForExistence(timeout: 5))
        submit.tap()
        XCTAssertTrue(webView.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'Enter' OR label CONTAINS '请填写'")).firstMatch.waitForExistence(timeout: 5),
                      "Create validation feedback is not visible")

        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(webView.waitForExistence(timeout: 10), "Resume replaced the Web state")

        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = "ios-packaged-parity"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
