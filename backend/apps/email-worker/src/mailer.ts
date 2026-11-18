import { OrderCreatedEvent } from '@app/common';
import * as nodemailer from 'nodemailer';

/**
 * Sends real email over SMTP. Which service is used is configuration, never code:
 *   - default (docker compose): Mailpit, a local test inbox at http://localhost:8025
 *   - an external provider (Mailtrap, Gmail, Brevo…): set SMTP_HOST/PORT/USER/PASS in .env
 */
export class Mailer {
  private readonly transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: process.env.SMTP_SECURE === 'true', // true for port 465
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  readonly from = process.env.MAIL_FROM ?? 'E-Commerce Shop <orders@shop.local>';
  readonly server = `${process.env.SMTP_HOST ?? 'localhost'}:${process.env.SMTP_PORT ?? 1025}`;

  /** Checks the SMTP connection (used at start-up, only for the log). */
  async verify(): Promise<boolean> {
    try {
      await this.transport.verify();
      return true;
    } catch {
      return false;
    }
  }

  async sendOrderConfirmation(e: OrderCreatedEvent): Promise<string> {
    const ref = e.orderId.slice(0, 8);
    const rows = e.items
      .map((i) => `<tr><td>${escape(i.name)}</td><td align="center">${i.quantity}</td><td align="right">$${(i.unitPrice * i.quantity).toFixed(2)}</td></tr>`)
      .join('');
    const info = await this.transport.sendMail({
      from: this.from,
      to: e.customerEmail,
      subject: `Order #${ref} received — $${e.total.toFixed(2)}`,
      text:
        `Thank you for your order #${ref}.\n\n` +
        e.items.map((i) => `- ${i.name} x${i.quantity}  $${(i.unitPrice * i.quantity).toFixed(2)}`).join('\n') +
        `\n\nTotal: $${e.total.toFixed(2)}\nShipping to: ${e.shippingAddress}\n`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px">
          <h2>Thank you for your order</h2>
          <p>Order <b>#${ref}</b> was received on ${new Date(e.createdAt).toUTCString()}.</p>
          <table width="100%" cellpadding="6" style="border-collapse:collapse;border:1px solid #ddd">
            <tr style="background:#f4f4f4"><th align="left">Product</th><th>Qty</th><th align="right">Subtotal</th></tr>
            ${rows}
            <tr><td colspan="2" align="right"><b>Total</b></td><td align="right"><b>$${e.total.toFixed(2)}</b></td></tr>
          </table>
          <p>Shipping to: ${escape(e.shippingAddress)}</p>
          <p style="color:#888;font-size:12px">You will be notified in the app when the status changes.</p>
        </div>`,
      headers: { 'X-Order-Id': e.orderId },
    });
    return info.messageId;
  }
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
