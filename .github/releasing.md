<div dir="rtl" align="right">

# انتشار

این متن فقط برای نگهداری مخزن است و داخل بستهٔ افزونه نیست. صفحهٔ Open VSX همان `readme.md` بسته‌شده را نشان می‌دهد.

## ساخت و انتشار خودکار در گیت‌هاب

گردش‌کار [Build and release VSIX](https://github.com/Fusoft-External/rtl-cursor/actions/workflows/build-release.yml) روی GitHub Actions اجرا می‌شود. یک VSIX مشترک برای VS Code، Cursor و Antigravity ساخته می‌شود.

- با Push روی `main` یا بازکردن Pull Request، تست‌های JavaScript، مراقب و مهاجرت ویندوز و تست واقعی Chromium/Monaco اجرا می‌شوند؛ سپس VSIX از همان سورس ساخته و محتوای بسته و مجوزها بررسی می‌شوند.
- خروجی از بخش Artifacts همان اجرا، با نام `rtl-cursor-<version>`، تا ۱۴ روز قابل دریافت است. گزینهٔ **Run workflow** هم ساخت دستی را بدون انتشار ریلیز اجرا می‌کند.
- برای انتشار نسخهٔ بعدی، شماره را در `package.json` و لودر و یادداشت‌های `readme.md` هماهنگ کنید، تغییرات را Commit و Push کنید و تگ همان نسخه را بفرستید؛ برای نمونه، پس از آماده‌کردن نسخهٔ ۱.۰.۱۸:

```powershell
git push origin main
git tag v1.0.18
git push origin v1.0.18
```

بعد از موفقیت همهٔ بررسی‌ها، تگ نسخه ریلیز GitHub را به‌صورت خودکار با VSIX، ابزار `update-agent-watcher.ps1` و فایل `SHA256SUMS.txt` منتشر می‌کند. متن ریلیز از بخش تغییرات همان نسخه در `readme.md` گرفته می‌شود. شمارهٔ تگ باید با بسته و لودر یکسان باشد؛ ریلیز موجود جایگزین نمی‌شود. انتشار از توکن داخلی GitHub Actions با دسترسی `contents: write` استفاده می‌کند و به توکن شخصی نیاز ندارد. این گردش‌کار به‌تنهایی در Open VSX یا Marketplace انتشار انجام نمی‌دهد. Push روی `main`، Pull Request و اجرای دستی این گردش‌کار فقط می‌سازند و ریلیز گیت‌هاب نمی‌سازند.

فرمان `cicd` یعنی آخرین نسخه، با همین شماره، در گیت‌هاب و Open VSX و Visual Studio Marketplace منتشر شود. کرسر از Open VSX و VS Code از مارکت‌پلیس نصب می‌کند. شماره‌ها باید یکی باشند. نسخه‌های قدیمیِ جاافتاده پر نمی‌شوند، مگر اینکه جدا خواسته شود.

## انتشار اختصاصی در Open VSX

گردش‌کار [Publish to Open VSX](https://github.com/Fusoft-External/rtl-cursor/actions/workflows/publish-openvsx.yml) با **Run workflow** اجرا می‌شود. با فرمان `cicd` همین گردش‌کار برای آخرین نسخه، هم‌شماره با گیت‌هاب و مارکت‌پلیس، اجرا می‌شود. گزینهٔ `publish` پیش‌فرض روشن است: همان تست‌ها و بیلد مشترک اجرا می‌شوند، سپس VSIX بررسی‌شده با Trusted Publishing منتشر می‌شود. نسخهٔ تازه اول چند دقیقه در بازبینی می‌ماند و در فهرست عمومی نیست؛ بررسی انتشار هر ۲۰ ثانیه رجیستری را می‌بیند و به محض عمومی شدن، فایل دریافت‌شده را با خروجی بیلد تطبیق می‌دهد. برای آزمون ساخت بدون انتشار، گزینهٔ `publish` را خاموش کنید.

یک‌بار در [Trusted Publishers](https://open-vsx.org/user-settings/trusted-publishers)، ارائه‌دهندهٔ GitHub Actions را برای افزونهٔ `fusoft.rtl-cursor` با این مشخصات ثبت کنید:

| تنظیم | مقدار |
| --- | --- |
| Namespace | `fusoft` |
| Extension | `rtl-cursor` |
| Organization or User name | `Fusoft-External` |
| Repository name | `rtl-cursor` |
| Workflow filename | `publish-openvsx.yml` |
| Environment name | `openvsx` |

ثبت این ارتباط به مالکیت Namespace و امضای Publisher Agreement نیاز دارد. افزونه باید دست‌کم یک نسخهٔ فعال داشته باشد. گردش‌کار از محیط گیت‌هاب `openvsx` و مجوز `id-token: write` استفاده می‌کند؛ نیازی به Secret یا `OVSX_PAT` نیست. نام ناشر در `package.json` باید دقیقاً با حروف نام Namespace یکسان باشد. جزئیات در [راهنمای رسمی Trusted Publishing](https://github.com/eclipse-openvsx/openvsx/wiki/Trusted-Publishing) آمده است.

نسخهٔ موجود دوباره منتشر نمی‌شود؛ شمارهٔ بسته و لودر و یادداشت‌های انتشار را پیش از انتشار بعدی به نسخه‌ای تازه تغییر دهید. در Open VSX حتی حذف یک نسخه هم شمارهٔ آن را آزاد نمی‌کند.

## انتشار اختصاصی در Visual Studio Marketplace

گردش‌کار [Publish to Visual Studio Marketplace](https://github.com/Fusoft-External/rtl-cursor/actions/workflows/publish-marketplace.yml) با **Run workflow** اجرا می‌شود. با فرمان `cicd` همین گردش‌کار برای آخرین نسخه، هم‌شماره با گیت‌هاب و Open VSX، اجرا می‌شود. گزینهٔ `publish` پیش‌فرض روشن است: همان تست‌ها و بیلد مشترک اجرا می‌شوند، سپس VSIX بررسی‌شده با Trusted Publishing منتشر می‌شود. برای آزمون ساخت بدون انتشار، گزینهٔ `publish` را خاموش کنید. فایل گردش‌کار باید همین نام بماند؛ سیاست Trusted Publishing به نام فایل و محیط `marketplace` وصل است.

یک‌بار در [Trusted Publishing](https://marketplace.visualstudio.com/manage/publishers/fusoft/trustedpublishing) برای ناشر `fusoft` این سیاست را ثبت کنید:

| تنظیم | مقدار |
| --- | --- |
| Repository owner | `Fusoft-External` |
| Repository | `rtl-cursor` |
| Workflow | `publish-marketplace.yml` |
| Environment | `marketplace` |

گردش‌کار از محیط گیت‌هاب `marketplace` و مجوز `id-token: write` استفاده می‌کند. نیازی به PAT یا Secret نیست. ابزار انتشار `@vscode/vsce` نسخهٔ `4.1.0` در `.github/ci` است و دستور انتشار `vsce publish --packagePath --oidc` است. پیش از انتشار، رجیستری برای همان شمارهٔ نسخه بررسی می‌شود و نسخهٔ موجود دوباره فرستاده نمی‌شود. پس از انتشار، فایل عمومی با خروجی بیلد مقایسه می‌شود.

</div>
