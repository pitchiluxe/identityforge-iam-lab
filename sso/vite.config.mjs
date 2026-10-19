import { defineConfig } from 'vite';
export default defineConfig({
  server:{host:'localhost',port:5173,strictPort:true,allowedHosts:['localhost']},
  preview:{host:'localhost',port:5173,strictPort:true,allowedHosts:['localhost']},
  build:{target:'es2022'},
});
