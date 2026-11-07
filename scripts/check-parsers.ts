// Synthetic checks for the bank-alert parsers copied from kharcha-mini. Run: npm run check:parsers
import assert from "node:assert/strict";
import { parseMessage } from "../src/server/parsers/index.ts";
import { parseIndianDate, parseAmount, decodeHtmlEntities } from "../src/server/parsers/utils.ts";

const parse = (key: string, body: string) => {
  const outcome = parseMessage(key, body);
  assert.equal(outcome.parsedBy, "regex", `expected ${key} to parse: ${body}`);
  assert.ok(outcome.parsed);
  return outcome.parsed;
};

// Axis: credit-card payment receipt keeps its category and account.
const axisPay = parse(
  "axis",
  "Payment of INR 1234.56 has been received towards your Axis Bank Credit Card XX1111 on 11-08-26 - Axis Bank",
);
assert.equal(axisPay.amount, 1234.56);
assert.equal(axisPay.merchant, "Axis Credit Card");
assert.equal(axisPay.category, "Credit Card Payment");
assert.equal(axisPay.date, "2026-08-11 00:00");
assert.equal(axisPay.accountLast4, "1111");

// Axis: multi-line UPI debit, CRED routed to card payment.
const axisCred = parse(
  "axis",
  "INR 1234.56 debited\nA/c no. XX2222\n11-08-26, 19:16:00\nUPI/P2M/700000000001/CRED Club\nNot you? SMS BLOCKUPI",
);
assert.equal(axisCred.merchant, "CRED Club");
assert.equal(axisCred.category, "Credit Card Payment");
assert.equal(axisCred.accountLast4, "2222");

// Axis: single-line NEFT salary credit.
const axisNeft = parse(
  "axis",
  "INR 250000.00 credited to A/c no. XX4444 on 01-04-26 at 09:15:00 IST. Info - NEFT/CMS000001/ACME PAYROLL.",
);
assert.equal(axisNeft.type, "income");
assert.equal(axisNeft.merchant, "ACME PAYROLL");
assert.equal(axisNeft.referenceNumber, "CMS000001");

// Axis: foreign card spend reports the stated currency, not a bare INR number.
const axisUsd = parse("axis", "Spent\nCard no. XX1111\nUSD 12.99\n11-08-26 10:02:11\nNETFLIX\nAvl Lmt INR 5000");
assert.equal(axisUsd.currency, "USD");
assert.equal(axisUsd.originalAmount, 12.99);
assert.equal(axisUsd.amount, 12.99);

// HDFC: card payment and the online-payment acknowledgement.
const hdfcPay = parse(
  "hdfc",
  "DEAR HDFCBANK CARDMEMBER, PAYMENT OF Rs. 2500.00 RECEIVED TOWARDS YOUR CREDIT CARD ENDING WITH 3333 ON 11-8-2026.YOUR AVAILABLE LIMIT IS RS. 50000.0",
);
assert.equal(hdfcPay.amount, 2500);
assert.equal(hdfcPay.date, "2026-08-11 00:00");
assert.equal(hdfcPay.accountLast4, "3333");

const hdfcOnline = parse(
  "hdfc",
  "HDFC Bank Cardmember, Online Payment of Rs.2500 vide Ref# 1000000001kfVDx was credited to your card ending 3333 On 12/AUG/2026_value Date 11/AUG/2026",
);
assert.equal(hdfcOnline.date, "2026-08-11 00:00");
assert.equal(hdfcOnline.referenceNumber, "1000000001KFVDX");

// HDFC: plain debit with merchant, and a credit.
const hdfcDebit = parse(
  "hdfc",
  "Rs.450.00 debited from your HDFC Bank A/c ending 1234 towards SWIGGY on 11-08-2026 at 13:05:00",
);
assert.equal(hdfcDebit.type, "expense");
assert.equal(hdfcDebit.merchant, "SWIGGY");
assert.equal(hdfcDebit.date, "2026-08-11 13:05");

const hdfcCredit = parse(
  "hdfc",
  "Rs.1500.00 credited to your HDFC Bank A/c ending 1234 on 11 Aug, 2026 from ACME PAYROLL",
);
assert.equal(hdfcCredit.type, "income");

// IndusInd: UPI debit, IMPS credit dated by the alert.
const indusUpi = parse(
  "indusind",
  "Debited for INR 200.00 towards UPI/800000000001/DR/TRIS/FDRL on 11-08-26",
);
assert.equal(indusUpi.amount, 200);
assert.equal(indusUpi.merchant, "TRIS");

const indusImps = parse(
  "indusind",
  "account XXXXXXX5555 is credited by Rs.400000 on 24-03-26 received from account XXXXXXX6666/TEST PERSON (IMPS Ref no. 900000000001)",
);
assert.equal(indusImps.type, "income");
assert.equal(indusImps.date, "2026-03-24 00:00");
assert.equal(indusImps.referenceNumber, "900000000001");

// Non-transaction notices stay out of the ledger.
for (const notice of [
  "123123 is your OTP for your Axis Bank Credit Card XX1111. Do not share it with anyone.",
  "Your HDFC Bank Credit Card ending 1234 has been used for Rs.2500 at MERCHANT on 11-08-2026. Your e-mandate will be debited on 15-08-2026",
  "We appreciate the recent payment towards your Credit Card ending with XX3333. Rs.999 remains pending.",
  "Your Axis Bank e-mandate for Netflix has been registered and INR 649 will be debited on approval.",
]) {
  for (const key of ["axis", "hdfc"]) {
    assert.equal(parseMessage(key, notice).parsed, null, `notice leaked via ${key}: ${notice}`);
  }
}

// Unknown bank keys never parse.
assert.equal(parseMessage("kotak", "INR 100 debited").parsedBy, "failed");
assert.equal(parseMessage(null, "INR 100 debited").parsedBy, "failed");

// HTML-entity bodies decode before matching.
const escaped = parse(
  "axis",
  "Amount Debited: INR 75.00 Date &amp; Time: 01-04-26, 19:03:35 Transaction Info: UPI/P2M/700000000001/Swiggy",
);
assert.equal(escaped.merchant, "Swiggy");
assert.equal(escaped.date, "2026-04-01 19:03");
assert.equal(decodeHtmlEntities("A&amp;B&#39;s"), "A&B's");

// Axis: card cashback credit is income; the "earned ... next statement" notice is not a second credit.
const axisCb = parse(
  "axis",
  "Congratulations! Cashback of INR 455 has been credited to your Axis Bank Flipkart Credit Card XX1111 towards your last month spends - Axis Bank",
);
assert.equal(axisCb.amount, 455);
assert.equal(axisCb.type, "income");
assert.equal(axisCb.category, "Refunds");
assert.equal(axisCb.merchant, "Axis Flipkart Card Cashback");
assert.equal(axisCb.accountLast4, "1111");
assert.equal(
  parseMessage("axis", "Cashback of INR 105.00 earned in September on Flipkart Axis Bank Credit Card no. XX1111 will reflect in your next statement.").parsedBy,
  "failed",
);

// Date and amount helpers.
assert.equal(parseIndianDate("11-08-26"), "2026-08-11 00:00");
assert.equal(parseIndianDate("11/08/2026", "13:05:07"), "2026-08-11 13:05");
assert.equal(parseIndianDate("11Aug26"), "2026-08-11 00:00");
assert.equal(parseIndianDate("11-Aug-2026"), "2026-08-11 00:00");
assert.equal(parseIndianDate("2026-08-11"), "2026-08-11 00:00");
assert.equal(parseIndianDate("31-02-2026"), null, "impossible date rejected");
assert.equal(parseIndianDate("not a date"), null);
assert.equal(parseAmount("1,23,456.78"), 123456.78);

// Axis salary, new format since 30 Sep 2026 ("Axis Bank A/c", "Ref:").
const axisNeftNew = parse("axis", "INR 250000.00 credited to Axis Bank A/c XX4444 on 30-09-26 at 13:07:01 IST. Ref: NEFT/CMS000002/ACME.View bal: https://example.test/x");
assert.deepEqual([axisNeftNew.type, axisNeftNew.amount, axisNeftNew.merchant, axisNeftNew.date], ["income", 250000, "ACME", "2026-09-30 13:07"]);

// Axis "Debit INR" alerts: SIP is investment, card auto-debit is a card payment.
const sip = parse("axis", "Debit INR 10000.00\nAxis Bank A/c XX2222\n18-08-26 08:19:35\nACH-DR-INDIAN CLEARING COR\nWhatsApp BAL to 9000000000");
assert.deepEqual([sip.type, sip.amount, sip.merchant, sip.date], ["investment", 10000, "INDIAN CLEARING CORP", "2026-08-18 08:19"]);
const autoDebit = parse("axis", "Debit INR 15942.44\nAxis Bank A/c XX2222\n23-07-25 01:27:15\nCreditCard Payment XX 1111\nWhatsApp BAL to 9000000000");
assert.deepEqual([autoDebit.type, autoDebit.category], ["expense", "Credit Card Payment"]);

// Axis receipt that quotes remaining dues is still a payment.
assert.equal(parse("axis", "Payment of INR 2500.00 has been received towards your Axis Bank Credit Card XX1111 on 05-11-26. Total amount due INR 0.00.").amount, 2500);

// HDFC reversal and refund are income (Refunds).
const rev = parse("hdfc", "Transaction Reversed!On HDFC Bank CREDIT Card xx3333 Amt: Rs.49.76 By EXAMPLE.COM On 2026-08-25:18:00:46");
assert.deepEqual([rev.type, rev.amount, rev.category, rev.date], ["income", 49.76, "Refunds", "2026-08-25 18:00"]);
const refund = parse("hdfc", "Alert! Rs. 162 refunded by PAY*SHOP FOOD        BANGALORE     KAR on 29/AUG/2026 & adjusted against HDFC Bank Credit Card 3333 View updated balance here: https://example.test/y");
assert.deepEqual([refund.type, refund.amount, refund.date], ["income", 162, "2026-08-29 00:00"]);

// Notices stay skipped: card e-mandate echo (the card sends its own Spent SMS) and a payment reminder.
assert.notEqual(parseMessage("hdfc", "AutoPay (E-mandate) Success! For ExampleCo.. Txn Amt:INR599.19 Dt:02/09/2026 Via:HDFC Bank CC 3333 Mandate ID: X1").parsedBy, "regex");
assert.notEqual(parseMessage("hdfc", "Alert! Payment pending of Rs 2765 for your HDFC Bank Credit Card 3333. Pay now: https://example.test/z Ignore if paid").parsedBy, "regex");

console.log("parser checks passed");
