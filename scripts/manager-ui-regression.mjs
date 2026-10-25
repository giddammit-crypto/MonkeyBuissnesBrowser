import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect } from "@playwright/test";

// Disposable local records only; the password list below is synthetic metadata,
// not a live account or a replacement for vault/credential security tests.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "soul-manager-ui-"));
const data = path.join(profile, "browser-data");
fs.mkdirSync(data, { recursive: true });
fs.writeFileSync(
  path.join(data, "bookmarks.json"),
  JSON.stringify([
    {
      id: "fixture-bookmark",
      title: "QA bookmark",
      url: "https://fixture.invalid/bookmark",
      createdAt: Date.now(),
    },
  ]),
);
fs.writeFileSync(
  path.join(data, "downloads.json"),
  JSON.stringify([
    {
      id: "fixture-download",
      filename: "Fixture download.pdf",
      url: "https://fixture.invalid/download.pdf",
      kind: "file",
      state: "completed",
      receivedBytes: 100,
      totalBytes: 100,
      startedAt: Date.now(),
    },
  ]),
);
let app;
try {
  app = await electron.launch({
    executablePath: process.env.SOUL_EXECUTABLE,
    cwd: root,
    args: [
      ...(process.platform === "linux"
        ? [
            "--ozone-platform=headless",
            "--disable-gpu",
            "--disable-dev-shm-usage",
          ]
        : []),
      ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
      "--no-proxy-server",
      `--user-data-dir=${profile}`,
      ".",
    ],
  });
  const shell = await app.firstWindow();
  await shell.waitForSelector(".app-shell");
  await app.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows()[0].setSize(920, 640),
  );
  await shell.evaluate(() =>
    window.browserApi.updateSettings({ theme: "dark" }),
  );
  await shell.waitForFunction(
    () => document.documentElement.dataset.theme === "dark",
  );
  await shell
    .locator(".sidebar")
    .getByRole("button", { name: "Закладки", exact: true })
    .click();
  const manager = shell.getByRole("region", { name: "Менеджер закладок" });
  const add = manager.getByRole("button", {
    name: "Добавить закладку",
    exact: true,
  });
  await add.click();
  await manager
    .getByLabel("Название", { exact: true })
    .fill("Rejected fixture bookmark");
  await manager
    .getByLabel("Адрес", { exact: true })
    .fill("ftp://fixture.invalid/file");
  await manager.getByRole("button", { name: "Сохранить", exact: true }).click();
  const error = manager.getByRole("alert");
  await expect(error).toContainText("HTTP(S)");
  assert(
    !/Error invoking remote method|browser:save-bookmark/.test(
      await error.innerText(),
    ),
  );
  const contrast = await error.evaluate((element) => {
    const rgb = (raw) => (raw.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const luminance = (values) =>
      values
        .map((value) => {
          const c = value / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        })
        .reduce(
          (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
          0,
        );
    const a = luminance(rgb(getComputedStyle(element).color));
    const b = luminance(rgb(getComputedStyle(document.body).backgroundColor));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  assert(contrast >= 4.5, `Dark error text contrast too low: ${contrast}`);
  await manager.getByLabel("Адрес", { exact: true }).press("Escape");
  await expect(manager).toBeVisible();
  await expect(manager.locator(".bookmark-editor")).toHaveCount(0);
  await expect(add).toBeFocused();
  await expect(manager.getByRole("alert")).toHaveCount(0);
  const edit = manager.getByRole("button", {
    name: "Изменить закладку QA bookmark",
    exact: true,
  });
  await edit.click();
  await manager
    .getByLabel("Название", { exact: true })
    .fill("Unsaved fixture change");
  await manager.getByLabel("Название", { exact: true }).press("Escape");
  await expect(edit).toBeFocused();
  await expect(
    manager.getByRole("button", {
      name: "Удалить закладку QA bookmark",
      exact: true,
    }),
  ).toBeVisible();
  await manager
    .getByRole("textbox", { name: "Поиск в закладках" })
    .fill("   qa BOOKMARK   ");
  await expect(manager.locator(".managed-entry")).toHaveCount(1);
  await manager.getByRole("textbox", { name: "Поиск в закладках" }).fill("   ");
  await expect(manager.locator(".managed-entry")).toHaveCount(1);
  console.log(
    "PASS clean validation error, dark contrast, editor Escape focus return and normalized bookmark search",
  );

  await shell
    .locator(".sidebar")
    .getByRole("button", { name: "Загрузки", exact: true })
    .click();
  await shell
    .getByRole("textbox", { name: "Поиск в загрузках" })
    .fill("no-fixture-match");
  await expect(
    shell.getByRole("heading", { name: "Ничего не найдено", exact: true }),
  ).toBeVisible();
  await expect(shell.locator(".empty-state")).toContainText(
    "Попробуйте другое название или адрес файла.",
  );
  assert(
    !(await shell.locator(".empty-state").innerText()).includes(
      "появятся здесь",
    ),
  );
  console.log("PASS download search has a search-specific empty state");

  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("browser:get-imported-passwords");
    ipcMain.handle("browser:get-imported-passwords", () => [
      {
        id: "metadata-fixture",
        origin: "https://fixture.invalid",
        username: "long-disposable-metadata-username@example.invalid",
        browser: "chrome",
        importedAt: Date.now(),
      },
    ]);
  });
  await shell
    .locator(".sidebar")
    .getByRole("button", { name: "Настройки", exact: true })
    .click();
  const passwords = shell.locator("[data-password-manager]");
  await expect(passwords.locator(".password-record")).toHaveCount(1);
  await passwords.scrollIntoViewIfNeeded();
  const layout = await passwords.evaluate((element) => {
    const record = element.querySelector(".password-record");
    const title = record.querySelector("strong").getBoundingClientRect();
    const login = record.querySelector("small").getBoundingClientRect();
    const search = element
      .querySelector("input[type=search]")
      .getBoundingClientRect();
    return {
      titleBottom: title.bottom,
      loginTop: login.top,
      searchHeight: search.height,
      overflow: element.scrollWidth > element.clientWidth,
    };
  });
  assert(
    layout.loginTop >= layout.titleBottom,
    "Credential origin and username must be on separate lines",
  );
  assert(
    layout.searchHeight >= 40,
    "Password search input must match the UI control size",
  );
  assert.equal(layout.overflow, false);
  console.log(
    "PASS password metadata layout and search control at 920×640 in dark theme",
  );
} finally {
  if (app) await app.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
