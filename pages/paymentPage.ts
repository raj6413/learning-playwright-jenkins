import { Page, expect, Locator } from "@playwright/test";
import cardData from "../fixtures/data/appdata.json";

export class checkoutPage {
  page: Page;
  cardNumber: Locator;
  cvv: Locator;
  expiryDate: Locator;
  payButton: Locator;
  cardHolderName: Locator;
  successMsg: Locator;

  constructor(page: Page) {
    this.page = page;
    this.cardNumber = page.getByTestId("credit_card_number");
    this.expiryDate = page.getByTestId("expiration_date");
    this.cvv = page.getByTestId("cvv");
    this.cardHolderName = page.getByTestId("card_holder_name");
    this.payButton = page.getByTestId("finish");
    this.successMsg = page.getByTestId("payment-success-message");
  }

  async fillCardDetail() {
    await this.cardNumber.fill(cardData.cardDetails.cardNumber);
    await this.expiryDate.fill(cardData.cardDetails.expirationDate);
    await this.cvv.fill(cardData.cardDetails.cvv);
    await this.cardHolderName.fill(cardData.cardDetails.cardHolderName);
  }

  async clickPay() {
    await Promise.all([
         this.payButton.click(),
      this.page.waitForResponse(
        (res) => res.url().includes("/check") && res.status() === 200
      )
    ]);
  }

  async expectSuccess() {
    await expect(this.successMsg).toContainText(cardData.successMessage);
  }
}
