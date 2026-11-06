import {test,expect} from "@playwright/test";
import {randomUUID} from "node:crypto";

test("register, top up mock balance, request job, download result",async({page})=>{
  await page.goto("/account");
  await page.getByRole("button",{name:"Нет аккаунта? Зарегистрироваться"}).click();
  await page.getByLabel("Email").fill("ui-"+randomUUID()+"@example.invalid");
  await page.getByLabel("Пароль").fill("Test Browser Password 2026!");
  await page.getByRole("button",{name:"Зарегистрироваться"}).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading",{name:"Мои генерации"})).toBeVisible();
  await page.getByRole("button",{name:"Получить тестовые 500 ₽"}).click();
  await expect(page.getByText(/500,00/)).toBeVisible();
  await page.goto("/apps/text-to-image");
  await page.getByLabel("Опиши желаемый результат").fill("An elegant electric scooter in a neon studio");
  await page.getByRole("button",{name:"Рассчитать стоимость"}).click();
  await expect(page.getByRole("button",{name:/Запустить за/})).toBeVisible();
  await page.getByRole("button",{name:/Запустить за/}).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText("Готово").first()).toBeVisible({timeout:30000});
  await page.getByRole("button",{name:"Показать результат"}).first().click();
  await expect(page.getByRole("link",{name:/Скачать image/})).toBeVisible();
  await page.goto("/library");
  await expect(page.getByRole("heading",{name:"Моя медиатека"})).toBeVisible();
  await expect(page.getByText("An elegant electric scooter in a neon studio")).toBeVisible();
  await page.getByRole("button",{name:/Открыть работу/}).first().click();
  await expect(page.getByRole("link",{name:"Скачать оригинал"})).toBeVisible();
  await expect(page.getByRole("link",{name:"Повторить с параметрами"})).toBeVisible();
  await page.getByRole("button",{name:"Удалить из медиатеки"}).click();
  await page.getByRole("button",{name:"Подтвердить удаление"}).click();
  await expect(page.getByText("An elegant electric scooter in a neon studio")).toHaveCount(0);

  // Check the real browser upload path for image-only applications.
  await page.goto("/apps/upscale");
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Yf6XVwAAAAASUVORK5CYII=","base64");
  await page.locator('input[type="file"]').setInputFiles({name:"tiny.png",mimeType:"image/png",buffer:png});
  await page.getByRole("button",{name:"Рассчитать стоимость"}).click();
  await expect(page.getByRole("button",{name:/Запустить за/})).toBeVisible();
  await page.getByRole("button",{name:/Запустить за/}).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByText("Готово").first()).toBeVisible({timeout:30000});
});

test("mobile catalog search and category filters",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/");
  await page.getByRole("button",{name:"Видео",exact:true}).click();
  await expect(page.getByText("Найдено: 2 из 10")).toBeVisible();
  await page.getByRole("searchbox",{name:"Поиск приложений"}).fill("текст");
  await expect(page.getByText("Найдено: 1 из 10")).toBeVisible();
  await page.getByText("Текст в видео",{exact:true}).first().click();
  await expect(page.getByRole("heading",{name:"Текст в видео",exact:true})).toBeVisible();
});
