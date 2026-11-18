import { expect, test } from "@playwright/test";

const run = `DST${Date.now().toString(36).toUpperCase()}`;

test("sell wholesale: customer, order, pick, ship, manifest, invoice, payment", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Stock to sell
  await page.goto("/inventory/receive");
  await page.locator('input[name="tag"]').fill(`${run}-JARS`);
  await page.locator('select[name="itemId"]').selectOption({ label: "Blue Mesa 3.5 g Jar (ea)" });
  await page.locator('input[name="quantity"]').fill("120");
  await page.locator('select[name="locationId"]').selectOption({ label: "Vault A / Rack 2" });
  await page.getByRole("button", { name: "Receive" }).click();
  await expect(page.getByRole("heading", { name: `${run}-JARS` })).toBeVisible();

  // New customer, not yet verified
  await page.goto("/distribution/customers");
  await page.locator('input[name="name"]').fill(`Shop ${run}`);
  await page.locator('input[name="licenseNumber"]').fill(`LIC-${run}`);
  await page.locator('input[name="licenseType"]').fill("Retailer");
  await page.locator('input[name="licenseExpires"]').fill("2031-12-31");
  await page.locator('input[name="paymentTermsDays"]').fill("30");
  await page.locator('input[name="address"]').fill("1 Test Plaza, Santa Fe, NM");
  await page.getByRole("button", { name: "Add vendor" }).click();
  await expect(page.getByRole("heading", { name: `Shop ${run}` })).toBeVisible();
  await expect(page.getByText("license has not been verified yet")).toBeVisible();
  const customerUrl = page.url();

  // Order: price comes from the default list; confirming is blocked until the license is verified
  await page.goto("/distribution");
  await page.locator('select[name="destinationId"]').selectOption({ label: `Shop ${run} (LIC-${run.toUpperCase()})` });
  await page.getByRole("button", { name: "Start order" }).click();
  await expect(page.getByRole("heading", { name: /^SO-\d{5}$/ })).toBeVisible();
  const orderUrl = page.url();
  await page.locator('select[name="itemId"]').selectOption({ label: "Blue Mesa 3.5 g Jar (ea)" });
  await page.locator('input[name="quantity"]').fill("100");
  await page.getByRole("button", { name: "Add line" }).click();
  await expect(page.getByText("100 ea at $12.50 = $1,250.00")).toBeVisible();
  await page.getByRole("button", { name: "Confirm order" }).click();
  await expect(page.locator('form p[role="alert"]')).toContainText("license has not been verified yet");

  await page.goto(customerUrl);
  await page.getByRole("button", { name: "Mark license verified" }).click();
  await expect(page.getByText("License verified.")).toBeVisible();
  await page.goto(orderUrl);
  await page.getByRole("button", { name: "Confirm order" }).click();
  await expect(page.getByText("Pick packages for each line")).toBeVisible();

  // Pick 100 of the 120: the picked part becomes a new package (a tag left blank would be generated)
  const pick = page.locator('form:has(input[name="tag"])');
  await pick.locator('input[name="tag"]').fill(`${run}-JARS`);
  await page.getByRole("button", { name: "Pick", exact: true }).click();
  await expect(page.locator('form p[role="alert"]')).toContainText("only needs 100 more");
  await pick.locator('input[name="quantity"]').fill("100");
  await pick.locator('input[name="newTag"]').fill(`${run}-OUT`);
  await page.getByRole("button", { name: "Pick", exact: true }).click();
  await expect(page.getByText("picked 100 of 100")).toBeVisible();

  await page.getByRole("button", { name: "Mark packed" }).click();
  await expect(page.getByText("Choose a driver and vehicle, then ship.")).toBeVisible();

  // Ship
  await page.locator('select[name="driverId"]').selectOption({ label: "Dana Ortiz" });
  await page.locator('select[name="vehicleId"]').selectOption({ index: 1 });
  await page.locator('input[name="departAt"]').fill("2026-11-17T09:30");
  await page.getByRole("button", { name: "Ship order" }).click();
  await expect(page.getByText("On the road.")).toBeVisible();

  // Manifest
  await page.getByRole("link", { name: /MAN-\d{5} \(print\)/ }).click();
  await expect(page.getByRole("heading", { name: "Transfer manifest" })).toBeVisible();
  await expect(page.getByRole("cell", { name: `${run}-OUT` })).toHaveCount(1);
  await expect(page.getByText(`Shop ${run}`).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("Dana Ortiz").filter({ visible: true }).first()).toBeVisible();

  // The shipped package left inventory; the rest stayed
  await page.goto(`/inventory?q=${run}`);
  await expect(page.getByText("2 packages shown")).toBeVisible();
  await expect(page.getByText("20 ea").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("finished").filter({ visible: true }).first()).toBeVisible();

  // Deliver, then invoice and payments
  await page.goto(orderUrl);
  await page.locator('input[name="receivedBy"]').fill("Pat Receiver");
  await page.getByRole("button", { name: "Mark delivered" }).click();
  await expect(page.getByText("received by Pat Receiver")).toBeVisible();

  await page.getByRole("link", { name: /INV-\d{5}/ }).click();
  await expect(page.getByRole("heading", { name: /Invoice INV-\d{5}/ })).toBeVisible();
  await expect(page.getByText("$1,250.00").filter({ visible: true }).first()).toBeVisible();
  const payment = page.locator("section", { has: page.getByRole("heading", { name: "Record a payment" }) });
  const credit = page.locator("section", { has: page.getByRole("heading", { name: "Issue a credit memo" }) });
  await payment.locator('input[name="amount"]').fill("5000");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(payment.locator('form p[role="alert"]')).toContainText("Only $1250.00 is still owed");
  await payment.locator('input[name="amount"]').fill("1000");
  await page.locator('input[name="reference"]').fill("Check 2041");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Payment recorded. $250.00 still owed.")).toBeVisible();
  // A credit memo for a damaged case lowers what's owed without money changing hands
  await credit.locator('input[name="amount"]').fill("50");
  await credit.locator('input[name="reason"]').fill("One case damaged in transit (test)");
  await page.getByRole("button", { name: "Issue credit" }).click();
  await expect(page.getByText("Credit recorded. $200.00 still owed.")).toBeVisible();
  await expect(page.getByText("Credit memo · One case damaged in transit (test)")).toBeVisible();
  await payment.locator('input[name="amount"]').fill("200");
  await page.locator('select[name="method"]').selectOption("CASH");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("paid", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0);
});

test("a budtender does not see distribution", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("budtender@demo.test");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("link", { name: "Distribution" })).toHaveCount(0);
  await page.goto("/distribution/invoices");
  await expect(page).toHaveURL(/\/dashboard/);
});
