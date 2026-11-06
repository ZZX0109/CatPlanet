import nodemailer from "nodemailer";
import { ses } from "tencentcloud-sdk-nodejs-ses";

export async function sendCode(email: string, code: string) {
  if (process.env.MAIL_DRIVER === "tencent") {
    const client = new ses.v20201002.Client({
      credential: {
        secretId: process.env.TENCENT_SECRET_ID!,
        secretKey: process.env.TENCENT_SECRET_KEY!,
      },
      region: process.env.SES_REGION || "ap-guangzhou",
    });
    await client.SendEmail({
      FromEmailAddress: process.env.MAIL_FROM!,
      Destination: [email],
      Subject: "喵星登录验证码",
      Template: {
        TemplateID: Number(process.env.SES_TEMPLATE_ID),
        TemplateData: JSON.stringify({ code }),
      },
    });
  } else {
    if (process.env.NODE_ENV === "production")
      throw new Error("production_requires_tencent_mail");
    await nodemailer
      .createTransport({
        host: process.env.SMTP_HOST || "127.0.0.1",
        port: Number(process.env.SMTP_PORT || 1025),
        secure: false,
        connectionTimeout: 5000,
      })
      .sendMail({
        from: "喵星 <hello@miaoxing.local>",
        to: email,
        subject: "喵星登录验证码",
        text: `你的验证码是 ${code}，10 分钟内有效。若非本人操作，请忽略此邮件。`,
      });
  }
}
