import { z } from "zod";
import { HttpError } from "./errors";

// Explicit allow-list: never accept a raw model ID or arbitrary provider URL from clients.
// M1 initially enables six scenarios backed by two verified WaveSpeed model families.
const prompt = z.string().trim().min(3).max(2000);
const imageRef = z.string().uuid();
const size = z.enum(["1024*1024","1536*1024","1024*1536"]).default("1024*1024");
const motionDuration = z.union([z.literal(5),z.literal(8)]).default(5);
const videoResolution = z.enum(["480p","720p"]).default("480p");

type ModelSpec = {
  modelId: string;
  mode: "text"|"image";
  inputSchema: z.ZodTypeAny;
  build: (input: Record<string,unknown>, imageUrl?: string)=>Record<string,unknown>;
};
const zImage = "wavespeed-ai/z-image/turbo";
export const modelSpecs: Record<string, ModelSpec> = {
  "text-to-image": {
    modelId:zImage,mode:"text",inputSchema:z.object({prompt,size}),
    build:i=>({prompt:i.prompt,size:i.size,output_format:"jpeg"})
  },
  "premium-image": {
    modelId:zImage,mode:"text",inputSchema:z.object({prompt,size}),
    build:i=>({prompt:i.prompt,size:i.size,output_format:"png"})
  },
  "photo-editor": {
    modelId:zImage,mode:"image",inputSchema:z.object({prompt,imageAssetId:imageRef,strength:z.number().min(0.1).max(0.9).default(0.6)}),
    build:(i,url)=>({prompt:i.prompt,image:url,strength:i.strength,size:"1024*1024"})
  },
  "background-swap": {
    modelId:zImage,mode:"image",inputSchema:z.object({prompt,imageAssetId:imageRef}),
    build:(i,url)=>({prompt:"Keep the subject unchanged; replace only the background. New background: "+i.prompt,image:url,strength:0.5,size:"1024*1024"})
  },
  "ai-portrait": {
    modelId:zImage,mode:"image",inputSchema:z.object({prompt,imageAssetId:imageRef}),
    build:(i,url)=>({prompt:"Portrait photography, creative editorial style: "+i.prompt,image:url,strength:0.55,size:"1024*1024"})
  },
  "product-shot": {
    modelId:zImage,mode:"image",inputSchema:z.object({prompt,imageAssetId:imageRef}),
    build:(i,url)=>({prompt:"Commercial product photography; preserve the product shape and logo. Scene: "+i.prompt,image:url,strength:0.45,size:"1024*1024"})
  },
  "photo-to-video": {
    modelId:"wavespeed-ai/wan-2.2/image-to-video",mode:"image",
    inputSchema:z.object({prompt,imageAssetId:imageRef,resolution:videoResolution,duration:motionDuration}),
    build:(i,url)=>({prompt:i.prompt,image:url,resolution:i.resolution,duration:i.duration})
  },
  "text-to-video": {
    modelId:"wavespeed-ai/wan-2.2/t2v-480p",mode:"text",
    inputSchema:z.object({prompt,duration:motionDuration,orientation:z.enum(["landscape","portrait"]).default("landscape")}),
    build:i=>({prompt:i.prompt,duration:i.duration,size:i.orientation==="portrait"?"480*832":"832*480"})
  },
  "ai-voiceover": {
    modelId:"minimax/speech-2.6-hd",mode:"text",
    inputSchema:z.object({text:z.string().trim().min(1).max(5000),voice:z.enum(["Russian_ReliableMan","Russian_AttractiveGuy","Russian_BrightHeroine","Russian_AmbitiousWoman"]).default("Russian_ReliableMan"),speed:z.number().min(0.5).max(2).default(1)}),
    build:i=>({text:i.text,voice_id:i.voice,speed:i.speed,format:"mp3",language_boost:"Russian"})
  },
  "upscale": {
    modelId:"wavespeed-ai/real-esrgan",mode:"image",
    inputSchema:z.object({imageAssetId:imageRef}),
    build:(_i,url)=>({image:url})
  },
};

export function prepareApp(slug: string, raw: unknown): { modelId:string; mode:"text"|"image"; input:Record<string,unknown>; imageAssetId?:string; spec:ModelSpec } {
  const spec=modelSpecs[slug];
  if(!spec) throw new HttpError(422,"APP_NOT_ENABLED","Этот инструмент ещё не подключён к API");
  const parsed = spec.inputSchema.safeParse(raw);
  if(!parsed.success) throw new HttpError(422,"INVALID_INPUT","Проверьте параметры приложения");
  const input=parsed.data as Record<string,unknown>;
  return {modelId:spec.modelId,mode:spec.mode,input,imageAssetId:spec.mode==="image"?String(input.imageAssetId):undefined,spec};
}
