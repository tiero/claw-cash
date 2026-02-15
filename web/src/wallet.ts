import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  type WalletClient,
  type PublicClient,
  type Chain,
} from "viem";
import { polygon, mainnet, arbitrum } from "viem/chains";

const CHAINS: Record<string, Chain> = {
  polygon,
  ethereum: mainnet,
  arbitrum,
};

export async function connectWallet(chainName: string): Promise<{
  walletClient: WalletClient;
  publicClient: PublicClient;
  address: `0x${string}`;
}> {
  if (!window.ethereum) {
    throw new Error("No wallet detected. Please install MetaMask.");
  }

  const chain = CHAINS[chainName];
  if (!chain) throw new Error(`Unsupported chain: ${chainName}`);

  const walletClient = createWalletClient({
    chain,
    transport: custom(window.ethereum),
  });

  const [address] = await walletClient.requestAddresses();

  // Switch chain if needed
  const currentChainId = await walletClient.getChainId();
  if (currentChainId !== chain.id) {
    try {
      await walletClient.switchChain({ id: chain.id });
    } catch {
      throw new Error(
        `Please switch to ${chainName} in your wallet.`
      );
    }
  }

  const publicClient = createPublicClient({
    chain,
    transport: custom(window.ethereum),
  });

  return { walletClient, publicClient, address };
}
