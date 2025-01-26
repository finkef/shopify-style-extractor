import fs from "node:fs"
import path from "node:path"
import puppeteer from "puppeteer"
import type { ExtractedShopStyles } from "./get-styles"

export async function renderStylePreview(
  url: string,
  styles: ExtractedShopStyles,
): Promise<string> {
  const browser = await puppeteer.launch({ headless: "new" })
  const page = await browser.newPage()

  const previewDir = path.join(process.cwd(), "previews")
  if (!fs.existsSync(previewDir)) {
    fs.mkdirSync(previewDir)
  }

  const html = `<!DOCTYPE html>
    <html>
      <head>
        <style>
          body { 
            background: ${styles.backgroundColor}; 
            display: flex; 
            flex: 1;
            flex-direction: column; 
            align-items: center; 
            justify-content: center;
            gap: 2rem;
            height: 100vh;
          }
          
          .preview-button {
            background: ${styles.primaryButton.backgroundColor};
            color: ${styles.primaryButton.textColor};
            border: ${styles.primaryButton.borderWidth} ${styles.primaryButton.borderStyle} ${styles.primaryButton.borderColor};
            border-radius: ${styles.primaryButton.borderRadius};
            padding: ${styles.primaryButton.padding};
            font-family: ${styles.primaryButton.fontFamily};
            font-weight: ${styles.primaryButton.fontWeight};
            text-transform: ${styles.primaryButton.textTransform};
            min-width: 200px;
          }
          
          .palette {
            display: flex;
            gap: 1rem;
            flex-wrap: wrap;
            max-width: 600px;
          }
          
          .swatch {
            width: 60px;
            height: 60px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          }

          .shop-url {
            font-size: 18px;
            color: #999;
            text-align: center;
            font-weight: 600;
            font-family: sans-serif;
          }
        </style>
      </head>
      <body>
        <button class="preview-button">Example Button</button>
        
        <div class="palette">
          ${styles.palette
            .map(
              (color) => `
            <div 
              class="swatch" 
              style="background: ${color}"
              title="${color}"
            ></div>
          `,
            )
            .join("")}
        </div>

        <div class="shop-url">
          ${url}
        </div>
      </body>
    </html>`

  await page.setContent(html)
  const screenshotPath = path.join(
    process.cwd(),
    `previews/preview-${Date.now()}.png`,
  )
  await page.screenshot({ path: screenshotPath })
  await browser.close()

  return screenshotPath
}
