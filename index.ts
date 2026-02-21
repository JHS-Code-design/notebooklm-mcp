import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import puppeteer, { Browser, Page } from "puppeteer";
import * as dotenv from "dotenv";

dotenv.config();

let browser: Browser | null = null;
let page: Page | null = null;

const GOOGLE_EMAIL = process.env.GOOGLE_EMAIL || "";
const GOOGLE_PASSWORD = process.env.GOOGLE_PASSWORD || "";

async function initBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: false, // 로그인 확인을 위해 브라우저 창 표시
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    page = await browser.newPage();
  }
  return page!;
}

async function loginToGoogle(page: Page) {
  await page.goto("https://notebooklm.google.com", { waitUntil: "networkidle2" });

  // 이미 로그인된 경우 스킵
  if (page.url().includes("notebooklm.google.com") && !page.url().includes("accounts.google.com")) {
    return;
  }

  // 구글 로그인
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.type('input[type="email"]', GOOGLE_EMAIL);
  await page.click("#identifierNext");

  await page.waitForSelector('input[type="password"]', { timeout: 10000 });
  await page.type('input[type="password"]', GOOGLE_PASSWORD);
  await page.click("#passwordNext");

  await page.waitForNavigation({ waitUntil: "networkidle2" });
}

async function createNotebook(title: string): Promise<string> {
  const p = await initBrowser();
  await loginToGoogle(p);

  await p.goto("https://notebooklm.google.com", { waitUntil: "networkidle2" });

  // 새 노트북 버튼 클릭
  try {
    await p.waitForSelector('[aria-label="New notebook"], button[jsname]', { timeout: 8000 });
    const buttons = await p.$$("button");
    for (const btn of buttons) {
      const text = await btn.evaluate((el) => el.textContent);
      if (text && text.includes("New notebook")) {
        await btn.click();
        break;
      }
    }

    // 제목 입력
    await p.waitForSelector('input[placeholder], input[aria-label]', { timeout: 5000 });
    await p.keyboard.type(title);
    await p.keyboard.press("Enter");

    return `노트북 "${title}" 생성 완료!`;
  } catch (e) {
    return `노트북 생성 중 오류 발생: ${e}. NotebookLM 페이지를 직접 확인해주세요.`;
  }
}

async function listNotebooks(): Promise<string> {
  const p = await initBrowser();
  await loginToGoogle(p);

  await p.goto("https://notebooklm.google.com", { waitUntil: "networkidle2" });

  try {
    const notebooks = await p.$$eval(
      '[data-testid="notebook-title"], .notebook-title, h3',
      (els) => els.map((el) => el.textContent?.trim()).filter(Boolean)
    );

    if (notebooks.length === 0) return "노트북이 없거나 목록을 불러오지 못했습니다.";
    return `노트북 목록:\n${notebooks.map((n, i) => `${i + 1}. ${n}`).join("\n")}`;
  } catch (e) {
    return `목록 불러오기 오류: ${e}`;
  }
}

// MCP 서버 설정
const server = new Server(
  { name: "notebooklm-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// 도구 목록
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "create_notebook",
      description: "새로운 NotebookLM 프로젝트를 생성합니다.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "노트북 제목" },
        },
        required: ["title"],
      },
    },
    {
      name: "list_notebooks",
      description: "현재 NotebookLM의 노트북 목록을 가져옵니다.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "open_notebooklm",
      description: "브라우저에서 NotebookLM을 엽니다.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ],
}));

// 도구 실행
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "create_notebook") {
    const title = (args as { title: string }).title;
    const result = await createNotebook(title);
    return { content: [{ type: "text", text: result }] };
  }

  if (name === "list_notebooks") {
    const result = await listNotebooks();
    return { content: [{ type: "text", text: result }] };
  }

  if (name === "open_notebooklm") {
    const p = await initBrowser();
    await loginToGoogle(p);
    return { content: [{ type: "text", text: "NotebookLM을 브라우저에서 열었습니다." }] };
  }

  throw new Error("지원하지 않는 도구입니다.");
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("NotebookLM MCP 서버가 실행 중입니다.");
}

run().catch(console.error);
