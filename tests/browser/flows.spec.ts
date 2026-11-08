import {test,expect} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";

const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGO45SMhGjGFAUIBACC9BH+K8i7ZAAAAAElFTkSuQmCC","base64");

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
  await page.locator('input[type="file"]').setInputFiles({name:"tiny.png",mimeType:"image/png",buffer:png});
  await page.getByRole("button",{name:"Рассчитать стоимость"}).click();
  await expect(page.getByRole("button",{name:/Запустить за/})).toBeVisible();
  await page.getByRole("button",{name:/Запустить за/}).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByText("Готово").first()).toBeVisible({timeout:30000});

  await page.goto("/apps/ai-b-roll");
  await page.getByLabel("Что происходит в кадре?").fill("Пар над чашкой кофе");
  await page.getByLabel("Атмосфера").selectOption("soft");
  await page.getByLabel("Формат").selectOption("portrait");
  await page.getByRole("button",{name:"Рассчитать стоимость"}).click();
  await page.getByRole("button",{name:/Запустить за/}).click();
  await expect(page).toHaveURL(/dashboard/);
  const bRollJob=page.getByRole("article").filter({hasText:"ai-b-roll"});
  await expect(bRollJob.getByText("Готово")).toBeVisible({timeout:30000});
  await page.goto("/library");
  await page.getByRole("button",{name:"Видео",exact:true}).click();
  const bRoll=page.getByRole("article").filter({hasText:"Пар над чашкой кофе"});
  await bRoll.getByRole("button",{name:/Открыть работу/}).click();
  await expect(page.getByRole("link",{name:"Скачать оригинал"})).toBeVisible();
  await page.getByRole("link",{name:"Повторить с параметрами"}).click();
  await expect(page.getByLabel("Что происходит в кадре?")).toHaveValue("Пар над чашкой кофе");
  await expect(page.getByLabel("Атмосфера")).toHaveValue("soft");
  await expect(page.getByLabel("Формат")).toHaveValue("portrait");
});

test("product card downloads a full-size PNG without an account",async({page})=>{
  await page.goto("/");
  await page.getByRole("link",{name:/Карточка товара/}).click();
  await page.getByLabel("Фото товара").setInputFiles({name:"photo.png",mimeType:"image/png",buffer:png});
  await page.getByLabel("Название товара").fill("Термокружка");
  await page.getByLabel("Преимущество (необязательно)").fill("450 мл");
  await page.getByLabel("Оформление").selectOption({label:"Тёмная витрина"});
  await page.getByRole("button",{name:"Создать карточку"}).click();
  await expect(page.getByRole("img",{name:"Готовая карточка товара"})).toBeVisible();
  const downloadPromise=page.waitForEvent("download");
  await page.getByRole("link",{name:"Скачать PNG"}).click();
  const download=await downloadPromise;
  const output=await readFile(await download.path());
  expect(download.suggestedFilename()).toBe("product-card.png");
  expect(output.subarray(0,8)).toEqual(png.subarray(0,8));
  expect(output.readUInt32BE(16)).toBe(1200);
  expect(output.readUInt32BE(20)).toBe(1600);
  await page.getByLabel("Название товара").fill("Чашка");
  await expect(page.getByRole("link",{name:"Скачать PNG"})).toHaveCount(0);
});

test("mobile catalog search and category filters",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/");
  await page.getByRole("button",{name:"Видео",exact:true}).click();
  await expect(page.getByText("Найдено: 3 из 12")).toBeVisible();
  await page.getByRole("searchbox",{name:"Поиск приложений"}).fill("текст");
  await expect(page.getByText("Найдено: 1 из 12")).toBeVisible();
  await page.getByText("Текст в видео",{exact:true}).first().click();
  await expect(page.getByRole("heading",{name:"Текст в видео",exact:true})).toBeVisible();
});
