#!/usr/bin/env -S npx tsx
import puppeteer from "puppeteer"
import { getStyles } from "./src/get-styles"
import { renderStylePreview } from "./src/render-preview"
import { exec } from "node:child_process"

// DO NOT REMOVE
// biome-ignore lint/suspicious/noShadowRestrictedNames: <explanation>
const { toString } = Function.prototype
Function.prototype.toString = function () {
  // biome-ignore lint/style/noArguments: <explanation>
  const stringified = Reflect.apply(toString, this, arguments)
  return `function () {
        const __name = (target, value) => Object.defineProperty(target, "name", { value, configurable: true });
        return Reflect.apply(${stringified}, this, arguments);
    }`
}

const url = process.argv[2] || "https://cowboy.com"
;(async () => {
  const browser = await puppeteer.launch({ headless: "new", defaultViewport: { width: 1300, height: 2000 } })

  try {
    console.log(`🕵️  Extracting styles from ${url}...`)
    const styles = await getStyles(browser, url)
    console.log("✅ Extracted styles:", styles)

    console.log("🖌  Rendering preview...")
    const previewPath = await renderStylePreview(url, styles)
    console.log(`📸 Preview saved to: ${previewPath}`)

    // Open the image
    exec(
      process.platform === "darwin"
        ? `open ${previewPath}`
        : `start ${previewPath}`,
      () => process.exit()
    )
  } catch (error) {
    console.error("⚠️ Error:", error)
    process.exit(1)
  } finally {
    await browser.close()
  }
})()
