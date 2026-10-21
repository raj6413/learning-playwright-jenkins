import { Page, expect, Locator } from "@playwright/test";
import cardData from "../fixtures/data/appdata.json";

export class loginPage {
  page: Page;
  public readonly loginBtn: Locator;
  public readonly username: Locator;
  public readonly password: Locator;
  public readonly submit: Locator;

  constructor(page: Page) {
    this.page = page;
    this.loginBtn = page.getByTestId("nav-sign-in");
    this.username = page.getByTestId("email");
    this.password = page.getByTestId("password");
    this.submit = page.getByTestId("login-submit");
  }

  async fillSubmitLogin(username: string, password: string) {
    await this.loginBtn.click();
    await this.username.fill(username);
    await this.password.fill(password);
    await this.submit.click();
  }
}
