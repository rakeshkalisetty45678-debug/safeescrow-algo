/**
 * SafeEscrow.algo — Wallet Integration
 * Real Pera Wallet + Defly + WalletConnect integration
 * using @perawallet/connect and algosdk
 */

import { PeraWalletConnect } from "@perawallet/connect";
import { DeflyWalletConnect } from "@blockshake/defly-connect";
import algosdk from "algosdk";

// ── Algorand node (free public nodes) ────────────────────────────
const ALGOD_SERVER  = "https://mainnet-api.algonode.cloud";
const ALGOD_PORT    = 443;
const ALGOD_TOKEN   = "";
const INDEXER_SERVER= "https://mainnet-idx.algonode.cloud";

export const algodClient   = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);
export const indexerClient = new algosdk.Indexer("", INDEXER_SERVER, ALGOD_PORT);

// Contract app IDs (set after deployment)
export const ESCROW_APPROVAL_TEAL = "/contracts/escrow_approval.teal";
export const USDC_ASSET_ID = 31566704; // Mainnet USDC ASA

// ── Wallet instances ──────────────────────────────────────────────
let peraWallet   = null;
let deflyWallet  = null;
let activeWallet = null;
let connectedAddress = null;

// ── State ─────────────────────────────────────────────────────────
export const walletState = {
  address:    null,
  provider:   null,
  algoBalance: 0,
  usdcBalance: 0,
};

// ── CONNECT ───────────────────────────────────────────────────────

export async function connectPera() {
  peraWallet = new PeraWalletConnect({ chainId: 416001 }); // 416001 = mainnet
  try {
    const accounts = await peraWallet.connect();
    const address  = accounts[0];
    activeWallet   = peraWallet;
    await _onConnected(address, "pera");
    return address;
  } catch (err) {
    if (err?.data?.type !== "CONNECT_MODAL_CLOSED") throw err;
  }
}

export async function connectDefly() {
  deflyWallet = new DeflyWalletConnect();
  try {
    const accounts = await deflyWallet.connect();
    const address  = accounts[0];
    activeWallet   = deflyWallet;
    await _onConnected(address, "defly");
    return address;
  } catch (err) {
    throw err;
  }
}

async function _onConnected(address, provider) {
  connectedAddress       = address;
  walletState.address    = address;
  walletState.provider   = provider;
  await refreshBalances(address);
  // Reconnect handler on page refresh
  activeWallet?.connector?.on("disconnect", disconnect);
}

export function disconnect() {
  activeWallet?.disconnect();
  activeWallet          = null;
  connectedAddress      = null;
  walletState.address   = null;
  walletState.provider  = null;
  walletState.algoBalance = 0;
  walletState.usdcBalance = 0;
}

// ── Reconnect on page load ────────────────────────────────────────
export async function reconnectSession() {
  try {
    peraWallet = new PeraWalletConnect({ chainId: 416001 });
    const accounts = await peraWallet.reconnectSession();
    if (accounts.length) {
      activeWallet = peraWallet;
      await _onConnected(accounts[0], "pera");
      return accounts[0];
    }
  } catch (_) {}
  return null;
}

// ── BALANCES ──────────────────────────────────────────────────────

export async function refreshBalances(address) {
  try {
    const info = await algodClient.accountInformation(address).do();
    walletState.algoBalance = info.amount / 1e6; // microALGO → ALGO

    const usdcAsset = (info.assets || []).find(a => a["asset-id"] === USDC_ASSET_ID);
    walletState.usdcBalance = usdcAsset ? usdcAsset.amount / 1e6 : 0;
  } catch (err) {
    console.error("Balance fetch failed:", err);
  }
  return { algo: walletState.algoBalance, usdc: walletState.usdcBalance };
}

// ── SIGN HELPER ───────────────────────────────────────────────────

async function signAndSend(txns) {
  if (!activeWallet) throw new Error("No wallet connected");
  const txnGroup = txns.map(t => ({ txn: t, signers: [connectedAddress] }));
  const signed   = await activeWallet.signTransaction([txnGroup]);
  const { txId } = await algodClient.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algodClient, txId, 4);
  return txId;
}

// ── ESCROW OPERATIONS ─────────────────────────────────────────────

/**
 * Deploy a new escrow smart contract
 * @param {string} recipient  - Algorand address
 * @param {number} amountAlgo - amount in ALGO (not micro)
 * @param {number} lockSecs   - lock period in seconds
 * @param {string} token      - "ALGO" or "USDC"
 */
export async function createEscrow({ recipient, amountAlgo, lockSecs, token, note }) {
  if (!connectedAddress) throw new Error("Wallet not connected");

  const params    = await algodClient.getTransactionParams().do();
  const amountMicro = Math.floor(amountAlgo * 1e6);
  const tokenId     = token === "USDC" ? USDC_ASSET_ID : 0;

  // 1. Deploy the application
  const approvalTeal = await fetch(ESCROW_APPROVAL_TEAL).then(r => r.text());
  const clearTeal    = `#pragma version 8\nint 1`;

  const { result: approvalResult } = await algodClient.compile(approvalTeal).do();
  const { result: clearResult }    = await algodClient.compile(clearTeal).do();

  const approvalProgram = new Uint8Array(Buffer.from(approvalResult, "base64"));
  const clearProgram    = new Uint8Array(Buffer.from(clearResult,    "base64"));

  const createTxn = algosdk.makeApplicationCreateTxnFromObject({
    from:              connectedAddress,
    suggestedParams:   params,
    onComplete:        algosdk.OnApplicationComplete.NoOpOC,
    approvalProgram,
    clearProgram,
    numLocalInts:      2,
    numLocalByteSlices:1,
    numGlobalInts:     8,
    numGlobalByteSlices:2,
    appArgs: [
      algosdk.encodeObj(recipient),
      algosdk.encodeUint64(lockSecs),
      algosdk.encodeUint64(tokenId),
    ],
    note: note ? new TextEncoder().encode(note) : undefined,
  });

  const createTxId = await signAndSend([createTxn]);

  // Get the new app ID from the confirmed transaction
  const pendingInfo = await algodClient.pendingTransactionInformation(createTxId).do();
  const appId = pendingInfo["application-index"];

  // 2. Fund the escrow contract with the actual amount
  const contractAddress = algosdk.getApplicationAddress(appId);

  let fundTxn;
  if (token === "ALGO") {
    fundTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from:            connectedAddress,
      to:              contractAddress,
      amount:          amountMicro,
      suggestedParams: params,
    });
  } else {
    // USDC: asset transfer
    fundTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from:            connectedAddress,
      to:              contractAddress,
      amount:          amountMicro,
      assetIndex:      USDC_ASSET_ID,
      suggestedParams: params,
    });
  }

  // 3. Call "fund" on the contract (atomic group)
  const callTxn = algosdk.makeApplicationCallTxnFromObject({
    from:            connectedAddress,
    appIndex:        appId,
    onComplete:      algosdk.OnApplicationComplete.NoOpOC,
    appArgs:         [new TextEncoder().encode("fund")],
    suggestedParams: params,
  });

  algosdk.assignGroupID([fundTxn, callTxn]);
  const fundTxId = await signAndSend([fundTxn, callTxn]);

  // Register in backend
  await fetch("/api/escrows", {
    method:  "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      app_id:    appId,
      sender:    connectedAddress,
      recipient,
      amount:    amountMicro,
      token,
      lock_end:  Math.floor(Date.now() / 1000) + lockSecs,
      note,
      tx_id:     fundTxId,
    }),
  });

  return { appId, createTxId, fundTxId };
}

/**
 * Cancel an escrow (within lock window, sender only)
 */
export async function cancelEscrow(appId) {
  const params  = await algodClient.getTransactionParams().do();
  const callTxn = algosdk.makeApplicationCallTxnFromObject({
    from:            connectedAddress,
    appIndex:        appId,
    onComplete:      algosdk.OnApplicationComplete.NoOpOC,
    appArgs:         [new TextEncoder().encode("cancel")],
    suggestedParams: params,
  });
  const txId = await signAndSend([callTxn]);
  await fetch(`/api/escrows/${appId}/status`, {
    method: "PATCH",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ status: "cancelled" }),
  });
  return txId;
}

/**
 * Claim escrow funds (recipient, after lock expires)
 */
export async function claimEscrow(appId) {
  const params  = await algodClient.getTransactionParams().do();
  const callTxn = algosdk.makeApplicationCallTxnFromObject({
    from:            connectedAddress,
    appIndex:        appId,
    onComplete:      algosdk.OnApplicationComplete.NoOpOC,
    appArgs:         [new TextEncoder().encode("claim")],
    suggestedParams: params,
  });
  const txId = await signAndSend([callTxn]);
  await fetch(`/api/escrows/${appId}/status`, {
    method: "PATCH",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ status: "claimed" }),
  });
  return txId;
}

/**
 * Open a dispute (pays 0.5 ALGO fee)
 */
export async function openDispute(appId, reason) {
  const params      = await algodClient.getTransactionParams().do();
  const contractAddr = algosdk.getApplicationAddress(appId);

  const feeTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from:            connectedAddress,
    to:              contractAddr,
    amount:          500_000, // 0.5 ALGO
    suggestedParams: params,
  });
  const callTxn = algosdk.makeApplicationCallTxnFromObject({
    from:            connectedAddress,
    appIndex:        appId,
    onComplete:      algosdk.OnApplicationComplete.NoOpOC,
    appArgs:         [new TextEncoder().encode("dispute")],
    suggestedParams: params,
  });
  algosdk.assignGroupID([feeTxn, callTxn]);
  const txId = await signAndSend([feeTxn, callTxn]);

  await fetch("/api/disputes", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ app_id: appId, opener: connectedAddress, reason }),
  });

  return txId;
}

/**
 * Vote in a dispute as a community juror
 */
export async function voteInDispute(appId, disputeId, side, stakeAlgo = 5) {
  const params      = await algodClient.getTransactionParams().do();
  const contractAddr = algosdk.getApplicationAddress(appId);
  const stakeMicro   = Math.floor(stakeAlgo * 1e6);
  const sideInt      = side === "sender" ? 0 : 1;

  // Opt in to local state first if needed
  const acctInfo  = await algodClient.accountInformation(connectedAddress).do();
  const alreadyIn = (acctInfo["apps-local-state"] || []).some(a => a.id === appId);

  const txns = [];
  if (!alreadyIn) {
    txns.push(algosdk.makeApplicationOptInTxnFromObject({
      from: connectedAddress, appIndex: appId, suggestedParams: params,
    }));
  }

  txns.push(algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: connectedAddress, to: contractAddr, amount: stakeMicro, suggestedParams: params,
  }));
  txns.push(algosdk.makeApplicationCallTxnFromObject({
    from: connectedAddress, appIndex: appId,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [new TextEncoder().encode("vote"), algosdk.encodeUint64(sideInt)],
    suggestedParams: params,
  }));

  if (txns.length > 1) algosdk.assignGroupID(txns);
  const txId = await signAndSend(txns);

  await fetch(`/api/disputes/${disputeId}/vote`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ side, stake: stakeAlgo }),
  });

  return txId;
}

/**
 * Resolve a dispute after voting closes
 */
export async function resolveDispute(appId, disputeId) {
  const params  = await algodClient.getTransactionParams().do();
  const callTxn = algosdk.makeApplicationCallTxnFromObject({
    from:            connectedAddress,
    appIndex:        appId,
    onComplete:      algosdk.OnApplicationComplete.NoOpOC,
    appArgs:         [new TextEncoder().encode("resolve")],
    suggestedParams: params,
  });
  const txId = await signAndSend([callTxn]);
  await fetch(`/api/disputes/${disputeId}/resolve`, { method: "POST" });
  return txId;
}

// ── QUERY HELPERS ─────────────────────────────────────────────────

export async function getEscrowState(appId) {
  try {
    const info = await algodClient.applicationInfo(appId).do();
    const gs   = {};
    for (const kv of info.params["global-state"]) {
      const key = atob(kv.key);
      gs[key]   = kv.value.type === 2 ? kv.value.uint : atob(kv.value.bytes || "");
    }
    return gs;
  } catch (err) {
    console.error("getEscrowState error:", err);
    return null;
  }
}

export async function getMyEscrows() {
  if (!connectedAddress) return [];
  const res = await fetch(`/api/escrows?address=${connectedAddress}`);
  return res.json();
}

export function getConnectedAddress() { return connectedAddress; }
export function isConnected()         { return !!connectedAddress; }
