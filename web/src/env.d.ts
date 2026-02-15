/// <reference types="vite/client" />

interface Window {
  ethereum?: import("viem").EIP1193Provider;
}
