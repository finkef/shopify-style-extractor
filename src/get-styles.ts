import fs from "node:fs"
import path from "node:path"
import ColorThief from "colorthief"
import { Vibrant } from "node-vibrant/node"
import type { Browser, Page } from "puppeteer"

export interface ExtractedShopStyles {
  /**
   * The vibrant palette of the page, sorted by population.
   */
  palette: string[]
  /**
   * The dominant background color of the page.
   */
  backgroundColor: string
  /**
   * The primary button on the page.
   */
  primaryButton: {
    backgroundColor: string
    textColor: string
    borderStyle?: string
    borderWidth: string
    borderColor: string
    borderRadius: string
    textTransform: string
    fontFamily: string
    fontWeight: string
    padding: string
  }
}

const DEFAULT_BUTTON_STYLE = {
  backgroundColor: "#000000",
  textColor: "#FFFFFF",
  borderStyle: "none",
  borderWidth: "0",
  borderColor: "#000000",
  borderRadius: "0",
  textTransform: "none",
  fontFamily:
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
  fontWeight: "normal",
  padding: "0",
}

const THEMES = [
  {
    name: "Dawn",
    schema_name: "Dawn",
    theme_store_id: 887,
    buttonSelector: ".button--primary",
  },
  {
    name: "Prestige",
    schema_name: "Prestige",
    theme_store_id: 855,
    buttonSelector: ".Button--primary",
  },
  {
    name: "Broadcast",
    schema_name: "Broadcast",
    theme_store_id: 868,
    buttonSelector: ".btn--primary",
  },
  {
    name: "Palo Alto",
    schema_name: "palo-alto",
    theme_store_id: 777,
    buttonSelector: ".btn--primary",
  },
  {
    name: "Modular",
    schema_name: "modular",
    theme_store_id: 849,
    buttonSelector: ".btn--primary",
  },
]

const DEFAULT_OPTIONS = {
  useProductPage: true,
  removeOverlays: false,
}

/**
 * Extracts styles from a given URL
 *
 * @param browser - The browser instance, keep this open for faster execution across multiple calls.
 * @param url - The URL to extract styles from
 * @param options - The options to use
 */
export async function getStyles(
  browser: Browser,
  url: string,
  options: {
    useProductPage?: boolean
    removeOverlays?: boolean
  } = DEFAULT_OPTIONS,
): Promise<ExtractedShopStyles> {
  const [targetUrl, page] = await Promise.all([
    (options.useProductPage ?? DEFAULT_OPTIONS.useProductPage)
      ? getProductPageUrl(url)
      : url,
    browser.newPage(),
  ])

  const tempDir = path.join(process.cwd(), "tmp")

  // Create temp dir if it doesn't exist
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir)
  }

  const screenshotFile = path.join(tempDir, `screenshot-${Date.now()}.png`)

  try {
    await page.setRequestInterception(true)
    page.on("request", (req) =>
      ["image", "video"].includes(req.resourceType())
        ? req.abort()
        : req.continue(),
    )

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 10000,
    })

    // Hide all images and videos; return the page height and shopify theme
    const { pageHeight, theme } = await page.evaluate(() => {
      const mediaElements = document.querySelectorAll(
        'img, video, [style*="background-image"]',
      )
      mediaElements.forEach((element) => {
        // @ts-ignore
        element.style.background = "transparent"
        // @ts-ignore
        element.style.opacity = "0"
      })

      /**
       * Need to explicitly define the themes here so puppeteer can access them.
       */
      const THEMES = [
        {
          name: "Dawn",
          schema_name: "Dawn",
          theme_store_id: 887,
          buttonSelector: ".button--primary",
        },
        {
          name: "Prestige",
          schema_name: "Prestige",
          theme_store_id: 855,
          buttonSelector: ".Button--primary",
        },
        {
          name: "Broadcast",
          schema_name: "Broadcast",
          theme_store_id: 868,
          buttonSelector: ".btn--primary",
        },
        {
          name: "Palo Alto",
          schema_name: "palo-alto",
          theme_store_id: 777,
          buttonSelector: ".btn--primary",
        },
        {
          name: "Modular",
          schema_name: "modular",
          theme_store_id: 849,
          buttonSelector: ".btn--primary",
        },
      ]

      // Matching theme
      let theme: string | null = null

      // @ts-ignore
      if (window.Shopify?.theme) {
        theme =
          THEMES.find(
            (t) =>
              // @ts-ignore
              t.schema_name === window.Shopify?.theme?.schema_name ||
              // @ts-ignore
              t.theme_store_id === window.Shopify?.theme?.theme_store_id,
          )?.name || null
      }

      return {
        pageHeight: document.documentElement.scrollHeight,
        theme,
      }
    })

    if (options.removeOverlays ?? DEFAULT_OPTIONS.removeOverlays) {
      await removeOverlays(page)
    }

    await page.screenshot({
      path: screenshotFile,
      clip: {
        x: 0,
        y: 0,
        width: 1300,
        height: Math.min(pageHeight - 200, 2000),
      },
      captureBeyondViewport: false,
    })

    // Extract main palette, most dominant color and buttons
    const [palette, bgRGB, buttons, themePrimaryButton] = await Promise.all([
      /**
       * Extract the vibrant colors, sorted by population.
       */
      Vibrant.from(screenshotFile)
        .getPalette()
        .then((palette) => {
          // Sort by population
          return Object.values(palette)
            .sort((a, b) => (b?.population ?? 0) - (a?.population ?? 0))
            .map((swatch) => swatch?.hex)
            .filter((hex): hex is string => Boolean(hex))
        }),
      /**
       * Extract the dominant color of the page.
       */
      ColorThief.getColor(screenshotFile).then(([r, g, b]) => ({
        r,
        g,
        b,
      })) as Promise<{ r: number; g: number; b: number }>,
      /**
       * Get all visible buttons on the page.
       */
      getButtons(page),
      /**
       * Find the best button based on the shopify theme.
       */
      findButtonBasedOnTheme(page, theme),
    ])

    /**
     * Find the best button based on our scoring function.
     */
    const { button: primaryButton } = buttons.reduce(
      (best, btnStyle) => {
        const currentScore = calculateButtonScore(btnStyle, bgRGB)
        return currentScore > best.score
          ? { button: btnStyle, score: currentScore }
          : best
      },
      {
        button: null as ExtractedShopStyles["primaryButton"] | null,
        score: -1,
      },
    )

    return {
      palette,
      backgroundColor: rgbToHex(bgRGB.r, bgRGB.g, bgRGB.b),
      // Favor the theme primary button if it exists, otherwise use the best button found.
      primaryButton:
        themePrimaryButton ?? primaryButton ?? DEFAULT_BUTTON_STYLE,
    }
  } finally {
    // fs.unlinkSync(screenshotFile)
  }
}

/**
 * Converts an RGB color to a hex string.
 */
function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

/**
 * Parses an RGB color string.
 */
function parseRgbString(colorStr: string) {
  const match = colorStr.match(
    /rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d?.?\d+))?\)/,
  )
  // group 4 might be alpha
  if (!match) return { r: 0, g: 0, b: 0, a: 1 }
  return {
    r: Number.parseInt(match[1], 10),
    g: Number.parseInt(match[2], 10),
    b: Number.parseInt(match[3], 10),
    a: match[4] ? Number.parseFloat(match[4]) : 1,
  }
}

/**
 * Parses a hex color string.
 */
function parseHexColor(color: string) {
  const c = color.replace("#", "")
  if (c.length === 3) {
    return {
      r: Number.parseInt(c[0] + c[0], 16),
      g: Number.parseInt(c[1] + c[1], 16),
      b: Number.parseInt(c[2] + c[2], 16),
    }
  }
  return {
    r: Number.parseInt(c.slice(0, 2), 16),
    g: Number.parseInt(c.slice(2, 4), 16),
    b: Number.parseInt(c.slice(4, 6), 16),
  }
}

/**
 * Calculates the contrast ratio between two colors.
 */
function getContrast(
  fg: { r: number; g: number; b: number },
  bg: { r: number; g: number; b: number },
) {
  const luminance = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  const l1 =
    luminance(fg.r / 255) * 0.2126 +
    luminance(fg.g / 255) * 0.7152 +
    luminance(fg.b / 255) * 0.0722
  const l2 =
    luminance(bg.r / 255) * 0.2126 +
    luminance(bg.g / 255) * 0.7152 +
    luminance(bg.b / 255) * 0.0722
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/**
 * Find all visible buttons on the page
 */
async function getButtons(page: Page) {
  return page.evaluate(() => {
    const btns = [
      ...Array.from(document.querySelectorAll("button")),
      ...Array.from(document.querySelectorAll("a[class*='btn']")),
      ...Array.from(document.querySelectorAll("a[class*='button']")),
      ...Array.from(document.querySelectorAll("[role='button']")),
    ] as HTMLElement[]

    const isVisible = (elem: HTMLElement) => {
      const style = window.getComputedStyle(elem)
      const rect = elem.getBoundingClientRect()
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity || "1") > 0 &&
        rect.width > 0 &&
        rect.height > 0
      )
    }

    return btns.filter(isVisible).map((btn) => {
      const style = window.getComputedStyle(btn)
      const textTransform = style.textTransform?.toLowerCase() || "none"
      const textContent = btn.textContent?.trim().toLowerCase() || ""
      const rect = btn.getBoundingClientRect()

      return {
        backgroundColor: style.backgroundColor,
        textColor: style.color,
        borderStyle: style.borderStyle,
        borderWidth: style.borderWidth,
        borderColor: style.borderColor,
        borderRadius: style.borderRadius,
        textTransform,
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        padding: style.padding,
        boundingRect: {
          width: rect.width,
          height: rect.height,
        },
        textContent,
      }
    })
  })
}

/**
 * Calculate the score of a button.
 */
function calculateButtonScore(
  btnStyle: any,
  bgRGB: { r: number; g: number; b: number },
): number {
  let score = -1

  let btnRGB = { r: 255, g: 255, b: 255 }
  if (/^rgb/i.test(btnStyle.backgroundColor)) {
    const { r, g, b, a = 1 } = parseRgbString(btnStyle.backgroundColor)
    if (a < 0.3) {
      // Low alpha, skip.
      return -1
    }
    btnRGB = { r, g, b }
  } else if (/^#([0-9A-Fa-f]{3,6})$/.test(btnStyle.backgroundColor)) {
    btnRGB = parseHexColor(btnStyle.backgroundColor)
  } else if (
    btnStyle.backgroundColor === "transparent" ||
    btnStyle.backgroundColor === "rgba(0, 0, 0, 0)"
  ) {
    // Low alpha, skip.
    return -1
  }

  const contrastRatio = getContrast(btnRGB, bgRGB)

  // Score based on contrast against primary background color
  score += contrastRatio * 3

  // Score based on CTA keywords
  const primaryCtaRegex =
    /(add\s*to\s*cart|add\s*to\s*bag|add\s*to\s*basket|buy\s*now|checkout|purchase|subscribe|shop\s*now|get\s*started|order\s*now)/i
  const secondaryCtaRegex = /(add\s*to\s*wishlist|add\s*to\s*wishlist)/i
  const cookieRegex = /(accept\s*cookies|accept\s*all)/i
  if (primaryCtaRegex.test(btnStyle.textContent)) {
    score += 25
  } else if (secondaryCtaRegex.test(btnStyle.textContent)) {
    score += 15
  } else if (cookieRegex.test(btnStyle.textContent)) {
    // Penalize cookies
    score -= 20
  }

  // Score based on size
  const { width, height } = btnStyle.boundingRect
  if (width > 120 && height > 35) {
    score += 5
  }

  // Penalize short text
  if (btnStyle.textContent.trim().length < 3) {
    score -= 5
  }

  return score
}

/**
 * Removes overlays from the page.
 *
 * NOTE: This is sometimes problematic if product images are wrapped in overlays.
 */
async function removeOverlays(page: Page) {
  await page.evaluate(() => {
    // Common overlay selectors - add more as needed
    const selectors = [
      '[class*="cookie"]',
      '[class*="overlay"]',
      '[class*="modal"]',
      '[class*="banner"]',
      '[aria-label*="banner"]',
      '[aria-label*="cookie"]',
      '[aria-label*="modal"]',
      "#gdpr-banner",
      ".cc-banner",
      '[role="dialog"]',
      '[role="alertdialog"]',
      ".ReactModal__Overlay",
      'div[style*="fixed"]', // Fixed position elements
      'div[style*="sticky"]', // Sticky elements
    ].join(",")

    document.querySelectorAll(selectors).forEach((element) => {
      ;(element as HTMLElement).style.display = "none"
      ;(element as HTMLElement).style.opacity = "0"
    })

    // Also check for full-screen overlays
    const fixedElements = document.querySelectorAll("body > *")
    fixedElements.forEach((element) => {
      const style = window.getComputedStyle(element)
      if (
        style.position === "fixed" &&
        style.zIndex === "9999" &&
        element.getBoundingClientRect().height > 100
      ) {
        element.remove()
      }
    })
  })

  // Wait for any potential layout changes
  await page.waitForTimeout(500)
}

/**
 * Gets a product page URL for the shop.
 * Return the main page URL if no product is found.
 */
async function getProductPageUrl(url: string) {
  try {
    const productsJson = await fetch(`${url}/products.json`).then((res) =>
      res.json(),
    )

    const productHandle = productsJson.products.find(
      (product: any) =>
        product.images.length > 0 &&
        product.published_at &&
        new Date(product.published_at) <
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    )?.handle

    if (!productHandle) throw new Error("No product found")

    return `${url}/products/${productHandle}`
  } catch (error) {
    console.log("Failed to get product page url, using main page instead.")
    return url
  }
}

/**
 * Tries to get the primary button based on the shopify theme.
 */
async function findButtonBasedOnTheme(page: Page, schemaName?: string | null) {
  if (!schemaName) return null

  const theme = THEMES.find((t) => t.schema_name === schemaName)
  if (!theme) return null

  const button = await page.evaluate(() => {
    const btn = document.querySelector(theme.buttonSelector)
    if (!btn) return null

    const style = window.getComputedStyle(btn)
    const textTransform = style.textTransform?.toLowerCase() || "none"
    const textContent = btn.textContent?.trim().toLowerCase() || ""
    const rect = btn.getBoundingClientRect()

    return {
      backgroundColor: style.backgroundColor,
      textColor: style.color,
      borderStyle: style.borderStyle,
      borderWidth: style.borderWidth,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      textTransform,
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      padding: style.padding,
      boundingRect: {
        width: rect.width,
        height: rect.height,
      },
      textContent,
    }
  })

  return button
}
