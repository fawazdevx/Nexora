import {config} from "./config.js";
import {createPublicClient, formatUnits, http, isAddress, pad, parseAbi, zeroAddress, type Hex} from "viem";
import {authorizeX402, paymentRequired, PolicyBlockedError, settleX402} from "./x402/facilitator.js";
import {addMissingAgentChainWallets, createAgentWallet, ensureCircleAgentPolicyRegistration, refreshPendingCircleWallets, submitAgentX402Settlement, updateAgentPolicy, upsertExternalPolicyWallet} from "./circle/agent-wallets.js";
import {approveCircleAgentPaymentIntent, circleAgentMarketplaceReadiness, circleAgentPaymentIntentAuthorization, completeCircleAgentPaymentIntentFromReceipt, createCircleAgentPaymentIntent, executeCircleAgentPaymentIntent, inspectCircleAgentService, payCircleAgentService, preflightCircleAgentPayment, rejectCircleAgentPaymentIntent, searchCircleAgentServices} from "./circle/agent-marketplace.js";
import {circleGatewayDiscoveryDocument, circleGatewaySellerCatalog, executeCircleGatewaySellerRequest} from "./circle/gateway-seller.js";
import {listEarnOpportunities} from "./earn/opportunities.js";
import {earnOptimizerProfilesStatus, evaluateAllEarnOptimizers} from "./earn/optimizer.js";
import {activatePlan, canonicalMarketplaceCatalog, discoveryDocument, executeBuiltInService, executeMarketplaceService, featureService, getService, listServices, platformPlans, publishService, publishVerifiedService, publishVerifiedServiceRoutes, reconcileCanonicalMarketplaceRoutes, requirePlatformPlan, subscribePlan} from "./marketplace/services.js";
import {operatorProfile} from "./identity/operators.js";
import {integrationReadiness} from "./readiness.js";
import {synthraApproval, synthraQuote, synthraReadiness, synthraSwap} from "./swap/synthra.js";
import {indexedAnalytics, syncArcIndexer} from "./indexer/arc.js";
import {normalizeMemo, paymentMemoSummary, publicMemoView} from "./memos.js";
import {
  dispatchNotification,
  handleTelegramWebhookUpdate,
  requestEmailNotificationVerification,
  syncTelegramNotificationLink,
  telegramBotStartUrl,
  verifyEmailNotificationCode
} from "./notifications.js";
import {automationRecipeTemplates, createAutomationRecipe, evaluateAutomationRecipes, updateAutomationRecipe} from "./automation/recipes.js";
import {evaluateEscrowReminders, updateEscrowReminderSettings} from "./escrow/reminders.js";
import {fetchDefiLlamaUsdcYields} from "./providers/defillama.js";
import {prepareTransactionPreflightArgs, runAgentTransactionPreflight} from "./providers/preflight.js";
import {simulateWithTenderly, tenderlyReadiness} from "./providers/tenderly.js";
import {
  addressArray,
  assertAuthenticatedTokenAddress,
  assertJsonObject,
  assertSharedSecret,
  assertTokenAddress,
  authContext,
  corsOrigin,
  issueAuthNonce,
  nonNegativeUsdcAmount,
  optionalBps,
  optionalChainId,
  optionalLimitedString,
  optionalTxHash,
  requiredAddress,
  requiredBytes32,
  requiredChainId,
  requiredLimitedString,
  requiredPositiveInteger,
  requiredTxHash,
  requiredUsdcAmount,
  securityHeaders,
  verifyAuthSignature,
  type AuthContext
} from "./security.js";
import {agentWalletAddresses, appSnapshot, archiveWorkspaceTestData, beginTelegramNotificationLink, isVisibleAgent, pushNotification, readStore, storageFriendlyError, updateNotificationPreferences, updateStore, visibleServicesForStore} from "./store.js";
import {settleFacilitatorPayment, supportedX402, verifyFacilitatorPayment} from "./x402/protocol-facilitator.js";
import {isMeridianNetwork, normalizeMeridianNetwork, reconcilePendingMeridianAccounting, settleGuardedMeridianPayment, supportedMeridianKinds, verifyMeridianPayment} from "./x402/meridian-facilitator.js";
import {buildSettlementRequirements, settlementConfigured, verifySettlementTx} from "./x402/settlement.js";
import {evaluateAgentPolicy} from "./policies/engine.js";
import {readBotChainReadiness} from "./botchain/readiness.js";
import {createVComputePaymentQuote} from "./botchain/vcompute.js";
import type {AgentApprovalRequestRecord, EscrowRecord, IndexedChainEventRecord, PaymentRecord, SubscriptionRecord} from "./store.js";

const erc20BalanceAbi = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

export type AppRequest = {
  method: string;
  url: string;
  host?: string;
  headers?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
};

export type AppResponse = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};

export async function handleAppRequest(req: AppRequest): Promise<AppResponse> {
  if (req.method === "OPTIONS") return {status: 204};

  try {
    const url = new URL(req.url, `http://${req.host ?? "localhost"}`);
    assertAllowedRequestOrigin(req);
    const body = req.body ?? {};
    const rawPath = url.pathname;
    const path = normalizePath(rawPath);
    const auth = authContext(header(req, "authorization"));

    if (req.method === "GET" && path === "/api/health") {
      return ok({ok: true, network: "Arc Testnet", chainId: config.arc.chainId});
    }

    if (req.method === "GET" && path === "/api/botchain/readiness") {
      return ok(await readBotChainReadiness({
        address: requiredAddress(url.searchParams.get("address"), "address"),
        network: url.searchParams.get("network")
      }));
    }

    if (req.method === "POST" && path === "/api/botchain/vcompute/quote") {
      return ok(createVComputePaymentQuote({
        network: optionalLimitedString(body.network, "network", 40),
        jobType: requiredLimitedString(body.jobType, "jobType", 64),
        units: requiredPositiveInteger(body.units, "units"),
        provider: optionalLimitedString(body.provider, "provider", 2_048)
      }));
    }

    if (req.method === "GET" && (path === "/x402/supported" || path === "/api/x402/supported")) {
      const base = supportedX402();
      // Merge the Arc EIP-3009 kinds with any Meridian Permit2 kinds (BotChain).
      // Meridian kinds are empty unless a Meridian API key is configured, so this
      // degrades to Arc-only when BotChain settlement is not set up.
      return ok({...base, kinds: [...base.kinds, ...supportedMeridianKinds()]});
    }

    // Public x402 discovery (task 4). Unauthenticated GET so external agents /
    // x402 clients can find Nexora's payable services. normalizePath rewrites a
    // non-/api/ path to /api/..., so /.well-known/x402 arrives as
    // /api/.well-known/x402 — match both. Same document as /api/discovery/resources.
    if (
      req.method === "GET"
      && (path === "/api/.well-known/x402" || path === "/.well-known/x402" || path === "/api/discovery/resources")
    ) {
      const query = url.searchParams.get("query") ?? undefined;
      const requestedVersion = url.searchParams.get("x402Version") ?? url.searchParams.get("version");
      if (requestedVersion === "1") return ok(await discoveryDocument(publicBaseUrl(req), query, 1));
      return ok(await circleGatewayDiscoveryDocument(publicBaseUrl(req), query));
    }

    if (req.method === "POST" && (path === "/x402/verify" || path === "/api/x402/verify")) {
      const verifyNetwork = ((body.paymentRequirements as {network?: unknown} | undefined)?.network);
      if (isMeridianNetwork(verifyNetwork)) {
        return ok(verifyMeridianPayment({
          paymentPayload: (body.paymentPayload ?? body.payment) as Parameters<typeof verifyMeridianPayment>[0]["paymentPayload"],
          paymentRequirements: body.paymentRequirements as Parameters<typeof verifyMeridianPayment>[0]["paymentRequirements"]
        }));
      }
      return ok(await verifyFacilitatorPayment({
        paymentPayload: body.paymentPayload ?? body.payment,
        paymentRequirements: body.paymentRequirements
      }));
    }

    // Keep the public facilitator endpoint separate from Nexora Marketplace's
    // authorization-id settlement endpoint. `normalizePath()` intentionally
    // maps public paths under `/api`, so matching `path === "/x402/settle"`
    // can never work and previously sent public x402 clients to the Marketplace
    // handler below. Match the original public path or the stable internal path.
    if (req.method === "POST" && (rawPath === "/x402/settle" || path === "/api/x402/facilitator-settle")) {
      const paymentPayload = body.paymentPayload ?? body.payment;
      const paymentRequirements = body.paymentRequirements;
      // BotChain (and other Permit2 networks) settle through Meridian's hosted
      // facilitator, not Nexora's self-submitted Arc path. Route by network.
      const settleNetwork = (paymentRequirements as {network?: unknown} | undefined)?.network;
      if (isMeridianNetwork(settleNetwork)) {
        return ok(await settleGuardedMeridianPayment({
          paymentPayload: paymentPayload as Parameters<typeof settleGuardedMeridianPayment>[0]["paymentPayload"],
          paymentRequirements: paymentRequirements as Parameters<typeof settleGuardedMeridianPayment>[0]["paymentRequirements"]
        }));
      }
      return ok(await settleFacilitatorPayment({
        paymentPayload,
        paymentRequirements
      }));
    }

    // Build seller-side requirements for the Nexora-owned settlement contract:
    // payTo = contract, seller + fee ceiling bound into the signed nonce. The
    // payer signs receiveWithAuthorization to the contract and submits settle()
    // themselves, so Nexora pays no gas and still earns feeBps.
    if (req.method === "POST" && path === "/api/x402/settlement/requirements") {
      const network = requiredLimitedString(body.network, "network", 40);
      if (!settlementConfigured(network)) {
        const error = new Error(`x402 settlement contract is not configured for ${network}`);
        (error as Error & {status?: number}).status = 400;
        throw error;
      }
      return ok(await buildSettlementRequirements({
        network,
        amountBaseUnits: requiredLimitedString(body.amountBaseUnits, "amountBaseUnits", 40),
        resource: requiredLimitedString(body.resource, "resource", 2_048),
        seller: requiredAddress(body.seller, "seller"),
        salt: requiredBytes32(body.salt, "salt") as `0x${string}`,
        maxFeeBps: optionalNumber(body.maxFeeBps),
        description: optionalLimitedString(body.description, "description", 1_000)
      }));
    }

    // Verify a settlement the payer/seller already broadcast, by reading the
    // on-chain SettlementCompleted event. The backend trusts the chain, not the
    // caller — nonce + seller must match what was signed.
    if (req.method === "POST" && path === "/api/x402/settlement/verify") {
      return ok(await verifySettlementTx({
        network: requiredLimitedString(body.network, "network", 40),
        txHash: requiredTxHash(body.txHash, "txHash"),
        expectedNonce: requiredBytes32(body.nonce, "nonce") as `0x${string}`,
        seller: requiredAddress(body.seller, "seller")
      }));
    }

    if (req.method === "GET" && path === "/api/readiness") {
      return ok(integrationReadiness());
    }

    if (req.method === "GET" && path === "/api/admin/deployments") {
      assertSharedSecret(header(req, "x-admin-secret"), config.security.adminSecret, "admin");
      return ok(await deploymentDashboard());
    }

    if (req.method === "POST" && path === "/api/admin/archive-test-data") {
      assertSharedSecret(header(req, "x-admin-secret"), config.security.adminSecret, "admin");
      return ok(await archiveWorkspaceTestData({
        reason: optionalLimitedString(body.reason, "reason", 240) ?? "Archived before clean Nexora demo",
        archiveAgents: body.archiveAgents !== false,
        archiveServices: body.archiveServices !== false
      }));
    }

    if (req.method === "POST" && path === "/api/admin/botchain/reconcile-accounting") {
      assertSharedSecret(header(req, "x-admin-secret"), config.security.adminSecret, "admin");
      const rawNetwork = optionalLimitedString(body.network, "network", 40);
      const normalizedNetwork = rawNetwork ? normalizeMeridianNetwork(rawNetwork) : null;
      if (rawNetwork && !normalizedNetwork) throw new Error("Unsupported BOT Chain network");
      const owner = body.owner === undefined || body.owner === null || body.owner === ""
        ? undefined
        : requiredAddress(body.owner, "owner");
      return ok(await reconcilePendingMeridianAccounting({network: normalizedNetwork ?? undefined, owner}));
    }

    if (req.method === "GET" && path === "/api/app") {
      const operator = optionalLimitedString(url.searchParams.get("operator"), "operator", 80);
      await refreshPendingCircleWallets(operator).catch(() => undefined);
      return ok(await appSnapshot(operator));
    }

    if (req.method === "POST" && path === "/api/auth/nonce") {
      return ok({nonce: issueAuthNonce(requiredAddress(body.address, "address"))});
    }

    if (req.method === "POST" && path === "/api/auth/verify") {
      return ok({
        token: await verifyAuthSignature({
          address: requiredAddress(body.address, "address"),
          nonce: requiredLimitedString(body.nonce, "nonce", 240),
          signature: optionalLimitedString(body.signature, "signature", 200)
        })
      });
    }

    if (req.method === "POST" && path === "/api/notifications/preferences") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertAuthenticatedTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await updateNotificationPreferences({
        operatorAddress,
        email: Object.hasOwn(body, "email") ? optionalEmail(body.email) : undefined,
        whatsapp: Object.hasOwn(body, "whatsapp") ? optionalWhatsApp(body.whatsapp) : undefined,
        telegram: Object.hasOwn(body, "telegram") ? optionalTelegram(body.telegram) : undefined,
        channels: Object.hasOwn(body, "channels") ? optionalNotificationChannels(body.channels) : undefined,
        events: Object.hasOwn(body, "events") ? optionalNotificationEvents(body.events) : undefined
      }));
    }

    if (req.method === "POST" && path === "/api/notifications/email/request") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertAuthenticatedTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await requestEmailNotificationVerification({
        operatorAddress,
        email: optionalEmail(body.email) ?? ""
      }));
    }

    if (req.method === "POST" && path === "/api/notifications/email/verify") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertAuthenticatedTokenAddress(auth, operatorAddress, "operatorAddress");
      const preferences = await verifyEmailNotificationCode({
        operatorAddress,
        email: optionalEmail(body.email) ?? "",
        code: requiredLimitedString(body.code, "code", 6)
      });
      return ok({
        verified: true,
        email: preferences.email,
        emailVerifiedAt: preferences.emailVerifiedAt,
        channels: preferences.channels
      });
    }

    if (req.method === "POST" && path === "/api/notifications/telegram/link") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertAuthenticatedTokenAddress(auth, operatorAddress, "operatorAddress");
      const code = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const preferences = await beginTelegramNotificationLink({operatorAddress, code, expiresAt});
      return ok({
        startUrl: await telegramBotStartUrl(code),
        code,
        expiresAt,
        status: preferences.telegramLink?.status ?? "pending"
      });
    }

    if (req.method === "POST" && path === "/api/notifications/telegram/confirm") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertAuthenticatedTokenAddress(auth, operatorAddress, "operatorAddress");
      const code = requiredLimitedString(body.code, "code", 80);
      const preferences = await syncTelegramNotificationLink({operatorAddress, code});
      return ok({
        connected: Boolean(preferences.telegram),
        telegram: preferences.telegram,
        telegramLink: preferences.telegramLink ?? null
      });
    }

    if (req.method === "GET" && path.startsWith("/api/operators/")) {
      return ok(await operatorProfile(decodeURIComponent(path.replace("/api/operators/", ""))));
    }

    if (req.method === "POST" && path === "/api/agents") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await createAgentWallet({
        operatorAddress,
        arcName: optionalLimitedString(body.arcName, "arcName", 120),
        dailyLimitUsdc: requiredUsdcAmount(body.dailyLimitUsdc, "dailyLimitUsdc"),
        transactionCapUsdc: requiredUsdcAmount(body.transactionCapUsdc, "transactionCapUsdc"),
        policyV2: optionalPolicyV2(body.policyV2)
      }));
    }

    if (req.method === "POST" && path === "/api/agents/external-eoa") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await upsertExternalPolicyWallet({
        operatorAddress,
        chainId: requiredChainId(body.chainId),
        policyRegistry: body.policyRegistry === undefined || body.policyRegistry === null || body.policyRegistry === ""
          ? undefined
          : requiredAddress(body.policyRegistry, "policyRegistry")
      }));
    }

    if (req.method === "POST" && path.startsWith("/api/agents/") && path.endsWith("/chain-wallets/backfill")) {
      const agentId = path.split("/")[3] ?? "";
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await addMissingAgentChainWallets({agentId, operatorAddress}));
    }

    if (req.method === "POST" && path.startsWith("/api/agents/") && path.endsWith("/policies/register")) {
      const agentId = path.split("/")[3] ?? "";
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await ensureCircleAgentPolicyRegistration(agentId, {
        operatorAddress,
        chainId: requiredChainId(body.chainId),
        policyRegistry: optionalLimitedString(body.policyRegistry, "policyRegistry", 80),
        dailyLimitUsdc: requiredUsdcAmount(body.dailyLimitUsdc, "dailyLimitUsdc"),
        transactionCapUsdc: requiredUsdcAmount(body.transactionCapUsdc, "transactionCapUsdc"),
        contractAllowlist: addressArray(body.contractAllowlist, "contractAllowlist"),
        recipientAllowlist: addressArray(body.recipientAllowlist, "recipientAllowlist"),
        policyV2: optionalPolicyV2(body.policyV2)
      }));
    }

    if ((req.method === "PATCH" || req.method === "POST") && path.startsWith("/api/agents/") && path.endsWith("/policies")) {
      const agentId = path.split("/")[3] ?? "local";
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await updateAgentPolicy(agentId, {
        operatorAddress,
        chainId: optionalChainId(body.chainId),
        dailyLimitUsdc: requiredUsdcAmount(body.dailyLimitUsdc, "dailyLimitUsdc"),
        transactionCapUsdc: requiredUsdcAmount(body.transactionCapUsdc, "transactionCapUsdc"),
        contractAllowlist: addressArray(body.contractAllowlist, "contractAllowlist"),
        recipientAllowlist: addressArray(body.recipientAllowlist, "recipientAllowlist"),
        policyV2: optionalPolicyV2(body.policyV2),
        txHash: optionalTxHash(body.txHash)
      }));
    }

    if (req.method === "POST" && path === "/api/policies/simulate") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await simulateAgentPolicy({
        operatorAddress,
        agentId: requiredLimitedString(body.agentId, "agentId", 120),
        serviceId: requiredLimitedString(body.serviceId, "serviceId", 120),
        units: requiredPositiveInteger(body.units ?? 1, "units", 1_000)
      }));
    }

    if (req.method === "POST" && path === "/api/agent-approvals") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return response(201, await createAgentApprovalRequest({
        operatorAddress,
        agentId: requiredLimitedString(body.agentId, "agentId", 120),
        serviceId: requiredLimitedString(body.serviceId, "serviceId", 120),
        units: requiredPositiveInteger(body.units ?? 1, "units", 1_000),
        note: optionalLimitedString(body.note, "note", 500)
      }));
    }

    if (req.method === "POST" && path.startsWith("/api/agent-approvals/") && path.endsWith("/approve")) {
      const requestId = path.split("/")[3] ?? "";
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await decideAgentApprovalRequest(requestId, operatorAddress, "approved", optionalLimitedString(body.note, "note", 500)));
    }

    if (req.method === "POST" && path.startsWith("/api/agent-approvals/") && path.endsWith("/reject")) {
      const requestId = path.split("/")[3] ?? "";
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await decideAgentApprovalRequest(requestId, operatorAddress, "rejected", optionalLimitedString(body.note, "note", 500)));
    }

    if (req.method === "GET" && path === "/api/automation/templates") {
      return ok({templates: automationRecipeTemplates()});
    }

    if (req.method === "POST" && path === "/api/automation/recipes") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return response(201, await createAutomationRecipe({
        operatorAddress,
        agentId: optionalLimitedString(body.agentId, "agentId", 120) ?? null,
        templateId: optionalLimitedString(body.templateId, "templateId", 120) ?? null,
        name: optionalLimitedString(body.name, "name", 120) ?? null,
        description: optionalLimitedString(body.description, "description", 500) ?? null,
        trigger: optionalAutomationTrigger(body.trigger),
        action: optionalAutomationAction(body.action),
        params: optionalAutomationParams(body.params)
      }));
    }

    if ((req.method === "PATCH" || req.method === "POST") && path.startsWith("/api/automation/recipes/")) {
      const recipeId = path.split("/")[4] ?? "";
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await updateAutomationRecipe({
        id: recipeId,
        operatorAddress,
        active: typeof body.active === "boolean" ? body.active : undefined,
        name: optionalLimitedString(body.name, "name", 120) ?? null,
        agentId: body.agentId === null ? null : optionalLimitedString(body.agentId, "agentId", 120),
        params: optionalAutomationParams(body.params)
      }));
    }

    if (req.method === "POST" && path === "/api/automation/evaluate") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await evaluateAutomationRecipes(operatorAddress));
    }

    if (req.method === "POST" && path === "/api/escrow-reminders/evaluate") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await evaluateEscrowReminders(operatorAddress));
    }

    if (req.method === "POST" && path === "/api/escrow-reminders/cron") {
      assertSharedSecret(header(req, "x-indexer-secret"), config.security.indexerSecret, "escrow reminders");
      return ok(await evaluateEscrowReminders());
    }

    if (req.method === "GET" && path === "/api/marketplace/services") {
      return ok({services: await listServices()});
    }

    if (req.method === "GET" && path === "/api/marketplace/catalog") {
      return ok({
        schemaVersion: "1.0",
        marketplace: "Nexora",
        x402: circleGatewaySellerCatalog(publicBaseUrl(req)),
        ledgerRoutes: await canonicalMarketplaceCatalog()
      });
    }

    if (req.method === "GET" && path === "/api/marketplace/canonical-catalog") {
      return ok(await canonicalMarketplaceCatalog());
    }

    if (req.method === "GET" && path === "/api/circle/nanopayments/catalog") {
      return ok(circleGatewaySellerCatalog(publicBaseUrl(req)));
    }

    if (req.method === "POST" && path.startsWith("/api/circle/nanopayments/services/")) {
      const endpointHash = decodeURIComponent(path.split("/")[5] ?? "");
      const sellerResponse = await executeCircleGatewaySellerRequest({
        endpointHash,
        args: assertJsonObject(body),
        paymentSignature: header(req, "payment-signature"),
        resourceUrl: publicResourceUrl(req, path)
      });
      return sellerResponse;
    }

    if (req.method === "POST" && path.startsWith("/api/circle/nanopayments/buy/")) {
      const endpointHash = decodeURIComponent(path.split("/")[5] ?? "");
      const sellerBaseUrl = configuredGatewaySellerBaseUrl();
      if (!sellerBaseUrl) return response(503, {error: "NEXORA_PUBLIC_API_URL is required for managed Gateway purchases."});
      const catalog = circleGatewaySellerCatalog(sellerBaseUrl);
      const service = catalog.services.find((item) => item.endpointHash === endpointHash);
      if (!service || !catalog.ready) return response(503, {error: "Nexora Gateway service is not ready."});
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await payCircleAgentService({
        operatorAddress,
        agentId: optionalLimitedString(body.agentId, "agentId", 120) ?? null,
        walletAddress: requiredAddress(body.walletAddress, "walletAddress"),
        serviceUrl: service.resource,
        chain: optionalLimitedString(body.chain, "chain", 40) ?? null,
        data: assertJsonObject(body.data),
        confirmed: Boolean(body.confirmed)
      }, {enabled: true, trustedNexoraGatewayOrigin: new URL(service.resource).origin}));
    }

    if (req.method === "GET" && path === "/api/circle/agent-marketplace/readiness") {
      return ok(await circleAgentMarketplaceReadiness());
    }

    if (req.method === "GET" && path === "/api/circle/agent-marketplace/search") {
      return ok(await searchCircleAgentServices(requiredLimitedString(url.searchParams.get("query"), "query", 160)));
    }

    if (req.method === "POST" && path === "/api/circle/agent-marketplace/inspect") {
      return ok(await inspectCircleAgentService(requiredLimitedString(body.serviceUrl ?? body.url, "serviceUrl", 2_048)));
    }

    if (req.method === "POST" && path === "/api/circle/agent-marketplace/guard") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await preflightCircleAgentPayment({
        operatorAddress,
        agentId: optionalLimitedString(body.agentId, "agentId", 120) ?? null,
        walletAddress: requiredAddress(body.walletAddress, "walletAddress"),
        serviceUrl: requiredLimitedString(body.serviceUrl ?? body.url, "serviceUrl", 2_048),
        chain: optionalLimitedString(body.chain, "chain", 40) ?? null,
        data: assertJsonObject(body.data)
      }));
    }

    if (req.method === "POST" && path === "/api/circle/agent-marketplace/intents") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return response(201, await createCircleAgentPaymentIntent({
        operatorAddress,
        agentId: optionalLimitedString(body.agentId, "agentId", 120) ?? null,
        walletAddress: requiredAddress(body.walletAddress, "walletAddress"),
        serviceUrl: requiredLimitedString(body.serviceUrl ?? body.url, "serviceUrl", 2_048),
        chain: optionalLimitedString(body.chain, "chain", 40) ?? null,
        data: assertJsonObject(body.data)
      }));
    }

    if (req.method === "POST" && path === "/api/circle/agent-marketplace/pay") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await payCircleAgentService({
        operatorAddress,
        agentId: optionalLimitedString(body.agentId, "agentId", 120) ?? null,
        walletAddress: requiredAddress(body.walletAddress, "walletAddress"),
        serviceUrl: requiredLimitedString(body.serviceUrl ?? body.url, "serviceUrl", 2_048),
        chain: optionalLimitedString(body.chain, "chain", 40) ?? null,
        data: assertJsonObject(body.data),
        confirmed: Boolean(body.confirmed)
      }));
    }

    if (req.method === "POST" && path.startsWith("/api/payment-intents/") && path.endsWith("/approve")) {
      const intentId = path.split("/")[3] ?? "";
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await approveCircleAgentPaymentIntent(intentId, {
        operatorAddress,
        note: optionalLimitedString(body.note, "note", 500) ?? null
      }));
    }

    if (req.method === "POST" && path.startsWith("/api/payment-intents/") && path.endsWith("/reject")) {
      const intentId = path.split("/")[3] ?? "";
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await rejectCircleAgentPaymentIntent(intentId, {
        operatorAddress,
        note: optionalLimitedString(body.note, "note", 500) ?? null
      }));
    }

    if (req.method === "POST" && path.startsWith("/api/payment-intents/") && path.endsWith("/execute")) {
      const intentId = path.split("/")[3] ?? "";
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await executeCircleAgentPaymentIntent(intentId, {
        operatorAddress,
        confirmed: Boolean(body.confirmed)
      }));
    }

    if (req.method === "GET" && path.startsWith("/api/payment-intents/") && path.endsWith("/authorization")) {
      const intentId = path.split("/")[3] ?? "";
      const operatorAddress = requiredAddress(url.searchParams.get("operatorAddress"), "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await circleAgentPaymentIntentAuthorization(intentId, operatorAddress));
    }

    if (req.method === "POST" && path.startsWith("/api/payment-intents/") && path.endsWith("/external-receipt")) {
      const intentId = path.split("/")[3] ?? "";
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await completeCircleAgentPaymentIntentFromReceipt(intentId, {
        operatorAddress,
        paymentResponse: body.paymentResponse,
        result: body.result
      }));
    }

    if (req.method === "GET" && path === "/api/public/builders") {
      return ok(await publicBuilderDirectory());
    }

    if (req.method === "GET" && path.startsWith("/api/public/receipts/")) {
      const receiptId = decodeURIComponent(path.replace("/api/public/receipts/", ""));
      return ok({receipt: await publicReceipt(receiptId)});
    }

    if (req.method === "GET" && path === "/api/x402/analytics") {
      return ok(await facilitatorAnalytics());
    }

    if (req.method === "GET" && path.startsWith("/api/marketplace/services/")) {
      const serviceId = path.split("/")[4] ?? "";
      const service = await getService(serviceId);
      if (!service) return response(404, {error: "service_not_found"});
      return ok({service});
    }

    if (req.method === "GET" && path === "/api/synthra/readiness") {
      return ok(synthraReadiness());
    }

    if (req.method === "GET" && path === "/api/providers/defillama/yields") {
      return ok({
        opportunities: await fetchDefiLlamaUsdcYields({
          limit: optionalNumber(url.searchParams.get("limit")) ?? 12,
          minTvlUsd: optionalNumber(url.searchParams.get("minTvlUsd")) ?? 250_000
        })
      });
    }

    if (req.method === "GET" && path === "/api/providers/tenderly/readiness") {
      return ok(tenderlyReadiness(tenderlyConfig()));
    }

    if (req.method === "POST" && path === "/api/providers/tenderly/simulate") {
      const from = requiredAddress(body.from, "from");
      assertTokenAddress(auth, from, "from");
      return ok(await simulateWithTenderly({...body, from}, tenderlyConfig()));
    }

    if (req.method === "POST" && (path === "/api/providers/transaction-preflight" || path === "/api/providers/preflight/transaction")) {
      const args = assertJsonObject(body);
      const request = prepareTransactionPreflightArgs(args);
      assertTokenAddress(auth, request.from, "from");
      return ok(await runAgentTransactionPreflight(args, preflightConfig()));
    }

    if (req.method === "POST" && path === "/api/synthra/quote") {
      return ok(await synthraQuote({
        chainId: optionalNumber(body.chainId) ?? config.arc.chainId,
        tokenIn: requiredAddress(body.tokenIn, "tokenIn"),
        tokenOut: requiredAddress(body.tokenOut, "tokenOut"),
        amount: String(requiredUsdcAmount(body.amount, "amount", 100_000))
      }));
    }

    if (req.method === "POST" && path === "/api/synthra/approval") {
      const owner = requiredAddress(body.owner, "owner");
      assertTokenAddress(auth, owner, "owner");
      return ok(await synthraApproval({
        chainId: optionalNumber(body.chainId) ?? config.arc.chainId,
        tokenIn: requiredAddress(body.tokenIn, "tokenIn"),
        tokenOut: requiredAddress(body.tokenOut, "tokenOut"),
        amount: String(requiredUsdcAmount(body.amount, "amount", 100_000)),
        owner
      }));
    }

    if (req.method === "POST" && path === "/api/synthra/swap") {
      const sender = requiredAddress(body.sender, "sender");
      assertTokenAddress(auth, sender, "sender");
      return ok(await synthraSwap({
        chainId: optionalNumber(body.chainId) ?? config.arc.chainId,
        tokenIn: requiredAddress(body.tokenIn, "tokenIn"),
        tokenOut: requiredAddress(body.tokenOut, "tokenOut"),
        amount: String(requiredUsdcAmount(body.amount, "amount", 100_000)),
        recipient: requiredAddress(body.recipient, "recipient"),
        sender,
        slippageBps: optionalBps(body.slippageBps, 100, 1000)
      }));
    }

    if (req.method === "POST" && path === "/api/marketplace/service-routes") {
      if (!Array.isArray(body.routes) || body.routes.length === 0 || body.routes.length > 50) {
        throw new Error("routes must contain between 1 and 50 service routes");
      }
      const routes = body.routes.map((raw, index) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`routes[${index}] must be an object`);
        const route = raw as Record<string, unknown>;
        const publisherAddress = requiredAddress(route.publisherAddress, `routes[${index}].publisherAddress`);
        assertTokenAddress(auth, publisherAddress, `routes[${index}].publisherAddress`);
        return {
          publisherAddress,
          name: requiredLimitedString(route.name, `routes[${index}].name`, 120),
          endpointHash: requiredLimitedString(route.endpointHash, `routes[${index}].endpointHash`, 120),
          pricePerUnitUsdc: requiredUsdcAmount(route.pricePerUnitUsdc, `routes[${index}].pricePerUnitUsdc`, 10_000),
          chainServiceId: optionalNumber(route.chainServiceId),
          settlementChainId: optionalNumber(route.settlementChainId),
          txHash: optionalTxHash(route.txHash),
          manifestKind: optionalLimitedString(route.manifestKind, `routes[${index}].manifestKind`, 80) as Parameters<typeof publishService>[0]["manifestKind"],
          description: optionalLimitedString(route.description, `routes[${index}].description`, 1_000),
          webhookUrl: optionalLimitedString(route.webhookUrl, `routes[${index}].webhookUrl`, 2_048),
          platformFeeBps: optionalBps(route.platformFeeBps, 200, 1000)
        };
      });
      return response(201, {services: await publishVerifiedServiceRoutes(routes)});
    }

    if (req.method === "POST" && path === "/api/marketplace/canonical-routes/reconcile") {
      const publisherAddress = requiredAddress(body.publisherAddress, "publisherAddress");
      assertTokenAddress(auth, publisherAddress, "publisherAddress");
      return ok(await reconcileCanonicalMarketplaceRoutes({
        publisherAddress,
        settlementChainId: requiredPositiveInteger(body.settlementChainId, "settlementChainId"),
        txHash: requiredTxHash(body.txHash, "txHash")
      }));
    }

    if (req.method === "POST" && path === "/api/marketplace/services") {
      const publisherAddress = requiredAddress(body.publisherAddress, "publisherAddress");
      assertTokenAddress(auth, publisherAddress, "publisherAddress");
      return response(201, await publishVerifiedService({
        publisherAddress,
        name: requiredLimitedString(body.name, "name", 120),
        endpointHash: requiredLimitedString(body.endpointHash, "endpointHash", 120),
        pricePerUnitUsdc: requiredUsdcAmount(body.pricePerUnitUsdc, "pricePerUnitUsdc", 10_000),
        chainServiceId: optionalNumber(body.chainServiceId),
        settlementChainId: optionalNumber(body.settlementChainId),
        txHash: optionalTxHash(body.txHash),
        manifestKind: optionalLimitedString(body.manifestKind, "manifestKind", 80) as Parameters<typeof publishService>[0]["manifestKind"],
        description: optionalLimitedString(body.description, "description", 1_000),
        webhookUrl: optionalLimitedString(body.webhookUrl, "webhookUrl", 2_048),
        platformFeeBps: optionalBps(body.platformFeeBps, 200, 1000)
      }));
    }

    if (req.method === "POST" && path === "/api/marketplace/feature") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await featureService({
        serviceId: requiredLimitedString(body.serviceId, "serviceId", 120),
        operatorAddress
      }));
    }

    if (req.method === "POST" && path.startsWith("/api/marketplace/services/") && path.endsWith("/execute")) {
      const serviceId = path.split("/")[4] ?? "";
      const payer = requiredAddress(body.payer, "payer");
      assertTokenAddress(auth, payer, "payer");
      return ok(await executeMarketplaceService({
        serviceId,
        payer,
        authorizationId: optionalLimitedString(body.authorizationId, "authorizationId", 120),
        args: assertJsonObject(body.args)
      }));
    }

    if (req.method === "GET" && path === "/api/monetization/plans") {
      return ok({plans: await platformPlans(), treasury: config.contracts.treasury, usdc: config.contracts.usdc, chainId: config.arc.chainId});
    }

    if (req.method === "POST" && path === "/api/monetization/subscribe") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return response(201, await subscribePlan({
        operatorAddress,
        plan: requiredLimitedString(body.plan, "plan", 80)
      }));
    }

    if (req.method === "POST" && path === "/api/monetization/activate") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      const plan = requiredLimitedString(body.plan, "plan", 80);
      const txHash = requiredTxHash(body.txHash, "txHash");
      const chainId = optionalNumber(body.chainId) ?? config.arc.chainId;
      await verifyPlanPayment({
        operatorAddress,
        plan,
        txHash,
        chainId
      });
      return response(201, await activatePlan({
        operatorAddress,
        plan,
        txHash,
        chainId
      }));
    }

    if (req.method === "POST" && path === "/api/x402/payment-required") {
      return response(402, paymentRequired({
        serviceId: requiredLimitedString(body.serviceId, "serviceId", 120),
        amountUsdc: requiredUsdcAmount(body.amountUsdc, "amountUsdc", 10_000),
        resource: requiredLimitedString(body.resource, "resource", 2_048),
        payTo: requiredAddress(body.payTo, "payTo")
      }));
    }

    if (req.method === "POST" && path === "/api/x402/authorize") {
      const payer = requiredAddress(body.payer, "payer");
      return ok(await authorizeX402({
        serviceId: requiredLimitedString(body.serviceId, "serviceId", 120),
        payer,
        requestHash: requiredBytes32(body.requestHash, "requestHash"),
        units: requiredPositiveInteger(body.units, "units", 1_000),
        agentId: optionalLimitedString(body.agentId, "agentId", 120),
        privacyScope: optionalMemoPrivacyScope(body.privacyScope),
        autoRetry: body.autoRetry === true
      }));
    }

    if (req.method === "POST" && path === "/api/x402/settle") {
      const authorizationId = requiredLimitedString(body.authorizationId, "authorizationId", 120);
      const agentId = optionalLimitedString(body.agentId, "agentId", 120);
      if (agentId) {
        const store = await readStore();
        const payment = store.payments.find((item) => item.authorizationId === authorizationId || item.id === authorizationId);
        const service = payment ? store.services.find((item) => item.id === payment.serviceId) : null;
        if (!payment || !service) throw new Error("settlement authorization not found");
        if (!service.chainServiceId) throw new Error("service is not published on-chain");
        const circleSettlement = await submitAgentX402Settlement({
          agentId,
          operatorAddress: payment.payer,
          authorizationId,
          serviceId: service.chainServiceId,
          requestHash: payment.requestHash,
          amountUsdc: payment.amountUsdc,
          units: payment.units,
          settlementChainId: service.settlementChainId,
          memo: normalizeMemo(body.memo) ?? normalizeMemo(payment.memo)
        });
        if (circleSettlement.state === "PENDING") {
          return ok({
            authorizationId,
            status: "pending_settlement",
            ...circleSettlement
          });
        }
        if (!circleSettlement.txHash) {
          throw new Error("Circle settlement completed without a network transaction hash");
        }
        const settlement = await settleX402({
          authorizationId,
          txHash: circleSettlement.txHash,
          memo: normalizeMemo(body.memo) ?? normalizeMemo(payment.memo),
          targetContract: circleSettlement.targetContract,
          callDataHash: circleSettlement.callDataHash,
          memoIndex: circleSettlement.memoIndex
        });
        return ok(settlement);
      }
      const settlement = await settleX402({
        authorizationId,
        txHash: optionalTxHash(body.txHash),
        memo: normalizeMemo(body.memo),
        targetContract: optionalLimitedString(body.targetContract, "targetContract", 80),
        callDataHash: optionalLimitedString(body.callDataHash, "callDataHash", 80),
        memoIndex: optionalNumber(body.memoIndex)
      });
      return ok(settlement);
    }

    if (req.method === "GET" && path === "/api/agents/memory") {
      const operator = requiredAddress(url.searchParams.get("operator"), "operator");
      return ok(await agentFinancialMemory(operator));
    }

    if (req.method === "GET" && path.startsWith("/api/developers/") && path.endsWith("/dashboard")) {
      return ok(await developerDashboard(decodeURIComponent(path.split("/")[3] ?? "")));
    }

    if (req.method === "GET" && path === "/api/revenue") {
      return ok(await platformRevenueDashboard());
    }

    if (req.method === "GET" && path === "/api/gateway/balances") {
      return ok(await gatewayBalances(requiredAddress(url.searchParams.get("address"), "address")));
    }

    if (req.method === "POST" && path === "/api/gateway/estimate") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await gatewayEstimate({
        sourceChainId: requiredPositiveInteger(body.sourceChainId, "sourceChainId", 100_000_000),
        destinationChainId: requiredPositiveInteger(body.destinationChainId, "destinationChainId", 100_000_000),
        sourceDepositor: operatorAddress,
        destinationRecipient: requiredAddress(body.destinationRecipient, "destinationRecipient"),
        amountUsdc: requiredUsdcAmount(body.amountUsdc, "amountUsdc", config.gateway.maxTransferUsdc),
        salt: requiredBytes32(body.salt, "salt")
      }));
    }

    if (req.method === "POST" && path === "/api/gateway/transfer") {
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await gatewayTransfer({
        operatorAddress,
        burnIntent: requiredGatewayBurnIntent(body.burnIntent),
        signature: requiredGatewaySignature(body.signature)
      }));
    }

    if (req.method === "GET" && path === "/api/indexer/arc/status") {
      return ok(await indexedAnalytics());
    }

    if (req.method === "GET" && path === "/api/escrows") {
      return ok({escrows: (await readStore()).escrows});
    }

    if (req.method === "POST" && path === "/api/escrows") {
      const creatorAddress = requiredAddress(body.creatorAddress, "creatorAddress");
      assertTokenAddress(auth, creatorAddress, "creatorAddress");
      return response(201, await createEscrow({
        creatorAddress,
        counterpartyAddress: requiredAddress(body.counterpartyAddress, "counterpartyAddress"),
        title: requiredLimitedString(body.title, "title", 140),
        description: requiredLimitedString(body.description, "description", 4_000),
        amountUsdc: requiredUsdcAmount(body.amountUsdc, "amountUsdc", 1_000_000),
        performanceBondUsdc: nonNegativeUsdcAmount(body.performanceBondUsdc ?? 0, "performanceBondUsdc", 1_000_000),
        platformFeeBps: optionalBps(body.platformFeeBps, 100, 1000),
        chainEscrowId: optionalNumber(body.chainEscrowId),
        txHash: optionalTxHash(body.txHash)
      }));
    }

    if (req.method === "DELETE" && path.startsWith("/api/escrows/")) {
      const escrowId = path.split("/")[3] ?? "";
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await removeEscrow(escrowId, operatorAddress));
    }

    if ((req.method === "PATCH" || req.method === "POST") && path.startsWith("/api/escrows/") && path.endsWith("/reminder")) {
      const escrowId = path.split("/")[3] ?? "";
      const operatorAddress = requiredAddress(body.operatorAddress, "operatorAddress");
      assertTokenAddress(auth, operatorAddress, "operatorAddress");
      return ok(await updateEscrowReminderSettings({
        escrowId,
        operatorAddress,
        enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
        deadlineAt: body.deadlineAt === undefined ? undefined : body.deadlineAt === null ? null : optionalIsoDate(body.deadlineAt, "deadlineAt"),
        offsetsHours: optionalReminderOffsets(body.offsetsHours),
        channels: optionalReminderChannels(body.channels),
        muted: typeof body.muted === "boolean" ? body.muted : undefined,
        snoozedUntil: body.snoozedUntil === undefined ? undefined : body.snoozedUntil === null ? null : optionalIsoDate(body.snoozedUntil, "snoozedUntil")
      }));
    }

    if (req.method === "POST" && path.startsWith("/api/escrows/") && path.endsWith("/fund")) {
      const escrowId = path.split("/")[3] ?? "";
      return ok(await updateEscrow(escrowId, "funded", {
        operatorAddress: requiredAddress(body.operatorAddress, "operatorAddress"),
        txHash: optionalTxHash(body.txHash)
      }, auth));
    }

    if (req.method === "POST" && path.startsWith("/api/escrows/") && path.endsWith("/submit")) {
      const escrowId = path.split("/")[3] ?? "";
      return ok(await updateEscrow(escrowId, "submitted", {
        operatorAddress: requiredAddress(body.operatorAddress, "operatorAddress"),
        deliverableUrl: optionalLimitedString(body.deliverableUrl, "deliverableUrl", 2_048),
        txHash: optionalTxHash(body.txHash),
        autoExecute: Boolean(body.autoExecute)
      }, auth));
    }

    if (req.method === "POST" && path.startsWith("/api/escrows/") && path.endsWith("/verify")) {
      const escrowId = path.split("/")[3] ?? "";
      return ok(await updateEscrow(escrowId, "verified", {
        operatorAddress: requiredAddress(body.operatorAddress, "operatorAddress"),
        verifierNotes: optionalLimitedString(body.verifierNotes, "verifierNotes", 2_000)
      }, auth));
    }

    if (req.method === "POST" && path.startsWith("/api/escrows/") && path.endsWith("/release")) {
      const escrowId = path.split("/")[3] ?? "";
      return ok(await updateEscrow(escrowId, "released", {
        operatorAddress: requiredAddress(body.operatorAddress, "operatorAddress"),
        txHash: optionalTxHash(body.txHash)
      }, auth));
    }

    if (req.method === "GET" && path === "/api/earn/opportunities") {
      return ok({opportunities: await listEarnOpportunities()});
    }

    if (req.method === "GET" && path === "/api/earn/optimizer") {
      return ok({profiles: await earnOptimizerProfilesStatus()});
    }

    if (req.method === "POST" && path === "/api/admin/earn/optimizer/evaluate") {
      assertSharedSecret(header(req, "x-admin-secret"), config.security.adminSecret, "admin");
      return ok(await evaluateAllEarnOptimizers({
        execute: body.execute === true,
        force: body.force === true
      }));
    }

    if ((req.method === "GET" || req.method === "HEAD") && path === "/api/webhooks/circle") {
      return {status: 200};
    }

    if (req.method === "POST" && path === "/api/webhooks/circle") {
      assertSharedSecret(header(req, "x-webhook-secret"), config.security.webhookSecret, "webhook");
      return ok({received: true, eventType: typeof body.type === "string" ? body.type : "unknown"});
    }

    if (req.method === "POST" && path === "/api/webhooks/telegram") {
      assertSharedSecret(header(req, "x-telegram-bot-api-secret-token"), config.notifications.telegram.webhookSecret, "telegram webhook");
      return ok(await handleTelegramWebhookUpdate(body));
    }

    if (req.method === "POST" && path === "/api/indexer/arc/sync") {
      assertSharedSecret(header(req, "x-indexer-secret"), config.security.indexerSecret, "indexer");
      return ok(await syncArcIndexer());
    }

    return response(404, {error: "not_found", path: rawPath, normalizedPath: path});
  } catch (error) {
    if (error instanceof PolicyBlockedError) {
      return response(error.status, {
        error: storageFriendlyError(error),
        code: "policy_blocked",
        paymentId: error.paymentId,
        remediation: error.remediation ?? null
      });
    }
    return response(statusFromError(error), {error: storageFriendlyError(error)});
  }
}

export function corsHeaders(origin?: string) {
  return {
    ...securityHeaders(),
    "access-control-allow-origin": corsOrigin(origin),
    "access-control-allow-methods": "GET,POST,PATCH,HEAD,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,payment-signature,x-payment,x-accept-payment,x402-version,x-admin-secret,x-webhook-secret,x-indexer-secret,x-telegram-bot-api-secret-token",
    "access-control-expose-headers": "payment-required,payment-response,x-accept-payment,x-payment-response,x402-version",
    "vary": "Origin"
  };
}

function ok(body: unknown) {
  return response(200, body);
}

function response(status: number, body: unknown): AppResponse {
  return {status, body};
}

function statusFromError(error: unknown) {
  const status = typeof error === "object" && error && "status" in error ? Number((error as {status?: unknown}).status) : 400;
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 400;
}

function header(req: AppRequest, key: string) {
  const wanted = key.toLowerCase();
  const found = Object.entries(req.headers ?? {}).find(([name]) => name.toLowerCase() === wanted);
  return found?.[1];
}

function assertAllowedRequestOrigin(req: AppRequest) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  const origin = header(req, "origin");
  const allowed = corsOrigin(origin);
  if (allowed !== "*" && origin && allowed !== origin.replace(/\/+$/, "")) {
    const error = new Error("origin is not allowed");
    (error as Error & {status?: number}).status = 403;
    throw error;
  }
}

// Derive the externally reachable base URL for discovery resource links. Prefer
// the request host (correct behind the actual public domain); the config public
// URL is the fallback (used when host is absent, e.g. in tests).
function publicBaseUrl(req: AppRequest): string | undefined {
  const host = req.host;
  if (!host) return undefined;
  const proto = header(req, "x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

function publicResourceUrl(req: AppRequest, path: string) {
  const baseUrl = publicBaseUrl(req) ?? config.notifications.publicAppUrl;
  return new URL(path, `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

function configuredGatewaySellerBaseUrl() {
  const value = config.circle.gatewaySeller.publicApiUrl.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) throw new Error("optional number is invalid");
  return numberValue;
}

function tenderlyConfig() {
  return {
    accessKey: config.integrations.tenderlyAccessKey,
    accountSlug: config.integrations.tenderlyAccountSlug,
    projectSlug: config.integrations.tenderlyProjectSlug,
    apiUrl: config.integrations.tenderlyApiUrl
  };
}

function preflightConfig() {
  return {
    tenderly: tenderlyConfig(),
    rpcUrls: preflightRpcUrls()
  };
}

function preflightRpcUrls() {
  const rpcUrls: Record<number, string> = {};
  addPreflightRpcUrl(rpcUrls, config.arc.chainId, config.arc.rpcUrl);
  addPreflightRpcUrl(rpcUrls, config.base.sepoliaChainId, config.base.sepoliaRpcUrl);
  addPreflightRpcUrl(rpcUrls, config.arbitrum.sepoliaChainId, config.arbitrum.sepoliaRpcUrl);
  addPreflightRpcUrl(rpcUrls, config.arbitrum.oneChainId, config.arbitrum.oneRpcUrl);
  return rpcUrls;
}

function addPreflightRpcUrl(target: Record<number, string>, chainId: number, rpcUrl: string) {
  if (Number.isInteger(chainId) && chainId > 0 && rpcUrl.trim()) target[chainId] = rpcUrl;
}

function optionalEmail(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const email = requiredLimitedString(value, "email", 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("email must be valid");
  return email;
}

function optionalWhatsApp(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const raw = requiredLimitedString(value, "whatsapp", 32).replace(/\s+/g, "");
  if (!/^\+?[1-9]\d{7,14}$/.test(raw)) throw new Error("whatsapp must be an international phone number");
  return raw.startsWith("+") ? raw : `+${raw}`;
}

function optionalTelegram(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const raw = requiredLimitedString(value, "telegram", 80).trim();
  if (/^-?\d{5,20}$/.test(raw)) return raw;
  throw new Error("telegram must be a numeric chat id. Open your bot in Telegram, send /start, then use the chat id returned by getUpdates.");
}

function optionalNotificationChannels(value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    inApp: record.inApp !== false,
    email: Boolean(record.email),
    whatsapp: Boolean(record.whatsapp),
    telegram: Boolean(record.telegram)
  };
}

function optionalNotificationEvents(value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    agentActions: record.agentActions !== false,
    paymentReceipts: record.paymentReceipts !== false,
    policyAlerts: record.policyAlerts !== false,
    escrowUpdates: record.escrowUpdates !== false
  };
}

function optionalMemoPrivacyScope(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const scope = requiredLimitedString(value, "privacyScope", 20);
  if (scope !== "public" && scope !== "selective" && scope !== "private") {
    throw new Error("privacyScope must be public, selective, or private");
  }
  return scope;
}

function optionalPolicyV2(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    weeklyLimitUsdc: nonNegativeUsdcAmount(record.weeklyLimitUsdc ?? 0, "weeklyLimitUsdc", 1_000_000),
    monthlyLimitUsdc: nonNegativeUsdcAmount(record.monthlyLimitUsdc ?? 0, "monthlyLimitUsdc", 1_000_000),
    maxUnitsPerRequest: optionalPositiveInteger(record.maxUnitsPerRequest, "maxUnitsPerRequest", 10_000),
    cooldownSeconds: optionalPositiveInteger(record.cooldownSeconds, "cooldownSeconds", 30 * 24 * 60 * 60),
    expiresAt: optionalIsoDate(record.expiresAt, "expiresAt"),
    serviceAllowlist: limitedStringArray(record.serviceAllowlist, "serviceAllowlist", 50, 160),
    requireOnchainPolicy: Boolean(record.requireOnchainPolicy)
  };
}

function optionalAutomationTrigger(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const trigger = requiredLimitedString(value, "trigger", 80);
  if (
    trigger === "daily_spend_threshold"
    || trigger === "failed_payment_burst"
    || trigger === "pending_approval_expiring"
    || trigger === "policy_expiring"
    || trigger === "large_receipt"
    || trigger === "weekly_summary"
  ) return trigger;
  throw new Error("automation trigger is invalid");
}

function optionalAutomationAction(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const action = requiredLimitedString(value, "action", 40);
  if (action === "notify" || action === "pause_agent") return action;
  throw new Error("automation action is invalid");
}

function optionalAutomationParams(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    thresholdUsdc: optionalNonNegativeNumber(record.thresholdUsdc, "thresholdUsdc", 1_000_000),
    thresholdPercent: optionalNonNegativeNumber(record.thresholdPercent, "thresholdPercent", 1000),
    failureCount: optionalPositiveInteger(record.failureCount, "failureCount", 100),
    windowHours: optionalPositiveInteger(record.windowHours, "windowHours", 24 * 90),
    expiresWithinHours: optionalPositiveInteger(record.expiresWithinHours, "expiresWithinHours", 24 * 365),
    minAmountUsdc: optionalNonNegativeNumber(record.minAmountUsdc, "minAmountUsdc", 1_000_000),
    cooldownHours: optionalPositiveInteger(record.cooldownHours, "cooldownHours", 24 * 90)
  };
}

function optionalReminderChannels(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    inApp: record.inApp !== false,
    email: Boolean(record.email),
    telegram: Boolean(record.telegram),
    whatsapp: Boolean(record.whatsapp)
  };
}

function optionalReminderOffsets(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error("offsetsHours must be an array");
  if (value.length > 8) throw new Error("offsetsHours has too many entries");
  return [...new Set(value.map((item, index) => {
    const parsed = typeof item === "number" ? item : Number(item);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 24 * 90) {
      throw new Error(`offsetsHours[${index}] must be a non-negative hour value`);
    }
    return parsed;
  }))].sort((a, b) => b - a);
}

function optionalNonNegativeNumber(value: unknown, label: string, max: number) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) throw new Error(`${label} must be a valid non-negative number`);
  return Math.round(parsed * 1_000_000) / 1_000_000;
}

function optionalPositiveInteger(value: unknown, label: string, max: number) {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) throw new Error(`${label} must be a valid non-negative integer`);
  return parsed;
}

function optionalIsoDate(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  const text = requiredLimitedString(value, label, 40);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid date`);
  return new Date(timestamp).toISOString();
}

function limitedStringArray(value: unknown, label: string, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  if (value.length > maxItems) throw new Error(`${label} has too many entries`);
  return [...new Set(value.map((item, index) => requiredLimitedString(item, `${label}[${index}]`, maxLength)))];
}

const gatewayDomains = [
  {domain: 26, chainId: config.arc.chainId, chain: "Arc Testnet", usdc: config.contracts.usdc},
  {domain: 3, chainId: config.arbitrum.sepoliaChainId, chain: "Arbitrum Sepolia", usdc: config.arbitrum.sepoliaUsdc},
  {domain: 6, chainId: config.base.sepoliaChainId, chain: "Base Sepolia", usdc: config.base.sepoliaUsdc}
] as const;

type GatewayBalanceResponse = {
  token?: string;
  balances?: Array<{
    domain?: number;
    depositor?: string;
    balance?: string;
  }>;
};

type GatewayDepositsResponse = {
  token?: string;
  deposits?: Array<{
    depositor?: string;
    domain?: number;
    transactionHash?: string;
    amount?: string;
    status?: string;
    blockHeight?: string;
    blockHash?: string;
    blockTimestamp?: string;
  }>;
};

async function gatewayBalances(address: string) {
  const [aggregate, perDomain, pending] = await Promise.all([
    gatewayPost<GatewayBalanceResponse>("/balances", {
      token: config.gateway.token,
      sources: [{depositor: address}]
    }),
    gatewayPost<GatewayBalanceResponse>("/balances", {
      token: config.gateway.token,
      sources: gatewayDomains.map(({domain}) => ({domain, depositor: address}))
    }),
    gatewayPost<GatewayDepositsResponse>("/deposits", {
      token: config.gateway.token,
      sources: [{depositor: address}]
    }).catch(() => ({token: config.gateway.token, deposits: []}))
  ]);

  const balances = gatewayDomains.map((domain) => {
    const match = perDomain.balances?.find((item) => item.domain === domain.domain);
    const balanceUsdc = parseGatewayBalance(match?.balance);
    return {
      ...domain,
      depositor: match?.depositor ?? address,
      balanceUsdc,
      balance: balanceUsdc.toFixed(6)
    };
  });
  const totalBalanceUsdc = parseGatewayBalance(aggregate.balances?.[0]?.balance);
  const deposits = (pending.deposits ?? []).map((deposit) => {
    const domain = gatewayDomains.find((item) => item.domain === deposit.domain);
    return {
      ...deposit,
      chainId: domain?.chainId ?? null,
      chain: domain?.chain ?? `Domain ${deposit.domain ?? "unknown"}`,
      amountUsdc: parseGatewayBalance(deposit.amount)
    };
  });

  return {
    token: aggregate.token ?? perDomain.token ?? config.gateway.token,
    totalBalanceUsdc,
    unifiedAvailableUsdc: totalBalanceUsdc,
    balances,
    pendingDeposits: deposits,
    gateway: {
      environment: gatewayApiUrl().includes("testnet") ? "testnet" : "mainnet",
      apiUrl: gatewayApiUrl()
    },
    updatedAt: new Date().toISOString()
  };
}

async function gatewayEstimate(input: {
  sourceChainId: number;
  destinationChainId: number;
  sourceDepositor: string;
  destinationRecipient: string;
  amountUsdc: number;
  salt: string;
}) {
  const source = requiredGatewayDomain(input.sourceChainId);
  const destination = requiredGatewayDomain(input.destinationChainId);
  if (source.domain === destination.domain) throw new Error("Gateway source and destination chains must differ");
  if (!source.usdc || !destination.usdc) throw new Error("Gateway USDC is not configured for the selected chains");
  const spec = {
    version: 1,
    sourceDomain: source.domain,
    destinationDomain: destination.domain,
    sourceContract: gatewayBytes32(config.gateway.walletAddress),
    destinationContract: gatewayBytes32(config.gateway.minterAddress),
    sourceToken: gatewayBytes32(source.usdc),
    destinationToken: gatewayBytes32(destination.usdc),
    sourceDepositor: gatewayBytes32(input.sourceDepositor),
    destinationRecipient: gatewayBytes32(input.destinationRecipient),
    sourceSigner: gatewayBytes32(input.sourceDepositor),
    destinationCaller: gatewayBytes32(zeroAddress),
    value: String(Math.round(input.amountUsdc * 1_000_000)),
    salt: input.salt,
    hookData: "0x"
  };
  const estimate = await gatewayPost<{
    body?: Array<{burnIntent?: GatewayBurnIntent}>;
    fees?: unknown;
  }>("/estimate?enableForwarder=true", [{spec}]);
  const burnIntent = estimate.body?.[0]?.burnIntent;
  if (!burnIntent) throw gatewayUpstreamError("Gateway estimate did not return a burn intent");
  const canonicalBurnIntent = normalizeGatewayBurnIntent(burnIntent);
  return {
    burnIntent: canonicalBurnIntent,
    fees: estimate.fees ?? null,
    source: {chainId: source.chainId, chain: source.chain, domain: source.domain},
    destination: {chainId: destination.chainId, chain: destination.chain, domain: destination.domain},
    destinationRecipient: input.destinationRecipient
  };
}

function normalizeGatewayBurnIntent(value: GatewayBurnIntent): GatewayBurnIntent {
  const normalized = structuredClone(value);
  const fields: Array<keyof GatewayBurnIntent["spec"]> = [
    "sourceContract", "destinationContract", "sourceToken", "destinationToken",
    "sourceDepositor", "destinationRecipient", "sourceSigner", "destinationCaller", "salt"
  ];
  for (const field of fields) {
    const candidate = normalized.spec[field];
    if (typeof candidate !== "string") throw gatewayUpstreamError("Gateway returned an invalid transfer estimate");
    if (/^0x[a-fA-F0-9]{40}$/.test(candidate)) {
      (normalized.spec[field] as string) = pad(candidate.toLowerCase() as Hex, {size: 32});
    }
    if (!/^0x[a-fA-F0-9]{64}$/.test(normalized.spec[field] as string)) {
      throw gatewayUpstreamError("Gateway returned an invalid transfer estimate");
    }
  }
  return normalized;
}

type GatewayBurnIntent = {
  maxBlockHeight: string;
  maxFee: string;
  spec: {
    version: number;
    sourceDomain: number;
    destinationDomain: number;
    sourceContract: string;
    destinationContract: string;
    sourceToken: string;
    destinationToken: string;
    sourceDepositor: string;
    destinationRecipient: string;
    sourceSigner: string;
    destinationCaller: string;
    value: string;
    salt: string;
    hookData: string;
  };
};

async function gatewayTransfer(input: {operatorAddress: string; burnIntent: GatewayBurnIntent; signature: string}) {
  const signer = gatewayAddressFromBytes32(input.burnIntent.spec.sourceSigner);
  const depositor = gatewayAddressFromBytes32(input.burnIntent.spec.sourceDepositor);
  if (signer.toLowerCase() !== input.operatorAddress.toLowerCase() || depositor.toLowerCase() !== input.operatorAddress.toLowerCase()) {
    const error = new Error("Gateway burn intent must be signed for the connected depositor");
    (error as Error & {status?: number}).status = 403;
    throw error;
  }
  const source = gatewayDomains.find((item) => item.domain === input.burnIntent.spec.sourceDomain);
  const destination = gatewayDomains.find((item) => item.domain === input.burnIntent.spec.destinationDomain);
  if (!source || !destination) throw new Error("Gateway burn intent uses an unsupported domain");
  if (source.domain === destination.domain) throw new Error("Gateway source and destination chains must differ");
  if (input.burnIntent.spec.sourceContract.toLowerCase() !== gatewayBytes32(config.gateway.walletAddress).toLowerCase()) {
    throw new Error("Gateway burn intent source contract mismatch");
  }
  if (input.burnIntent.spec.destinationContract.toLowerCase() !== gatewayBytes32(config.gateway.minterAddress).toLowerCase()) {
    throw new Error("Gateway burn intent destination contract mismatch");
  }
  if (input.burnIntent.spec.sourceToken.toLowerCase() !== gatewayBytes32(source.usdc).toLowerCase()) {
    throw new Error("Gateway burn intent source token mismatch");
  }
  if (input.burnIntent.spec.destinationToken.toLowerCase() !== gatewayBytes32(destination.usdc).toLowerCase()) {
    throw new Error("Gateway burn intent destination token mismatch");
  }
  if (input.burnIntent.spec.destinationCaller.toLowerCase() !== gatewayBytes32(zeroAddress).toLowerCase()) {
    throw new Error("Gateway destination caller is not supported");
  }
  const maxTransferAtomic = BigInt(Math.round(config.gateway.maxTransferUsdc * 1_000_000));
  if (BigInt(input.burnIntent.spec.value) > maxTransferAtomic) {
    throw new Error(`Gateway transfer exceeds the ${config.gateway.maxTransferUsdc} USDC limit`);
  }
  const result = await gatewayPost<Record<string, unknown>>("/transfer?enableForwarder=true", [{
    burnIntent: input.burnIntent,
    signature: input.signature
  }]);
  return {
    ...result,
    source: {chainId: source.chainId, chain: source.chain, domain: source.domain},
    destination: {
      chainId: destination.chainId,
      chain: destination.chain,
      domain: destination.domain,
      recipient: gatewayAddressFromBytes32(input.burnIntent.spec.destinationRecipient)
    },
    forwarded: true
  };
}

function requiredGatewayBurnIntent(value: unknown): GatewayBurnIntent {
  if (!value || typeof value !== "object") throw new Error("burnIntent is required");
  const burnIntent = value as GatewayBurnIntent;
  const spec = burnIntent.spec;
  if (!spec || typeof spec !== "object") throw new Error("burnIntent.spec is required");
  if (spec.version !== 1) throw new Error("unsupported Gateway burn intent version");
  for (const [label, candidate] of Object.entries({
    sourceContract: spec.sourceContract,
    destinationContract: spec.destinationContract,
    sourceToken: spec.sourceToken,
    destinationToken: spec.destinationToken,
    sourceDepositor: spec.sourceDepositor,
    destinationRecipient: spec.destinationRecipient,
    sourceSigner: spec.sourceSigner,
    destinationCaller: spec.destinationCaller,
    salt: spec.salt
  })) {
    if (typeof candidate !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(candidate)) throw new Error(`burnIntent.spec.${label} must be bytes32`);
  }
  if (!/^\d+$/.test(String(burnIntent.maxBlockHeight))) throw new Error("burnIntent.maxBlockHeight is invalid");
  if (!/^\d+$/.test(String(burnIntent.maxFee))) throw new Error("burnIntent.maxFee is invalid");
  if (!/^\d+$/.test(String(spec.value)) || BigInt(spec.value) <= 0n) throw new Error("burnIntent.spec.value is invalid");
  if (typeof spec.hookData !== "string" || !/^0x(?:[a-fA-F0-9]{2})*$/.test(spec.hookData)) throw new Error("burnIntent.spec.hookData is invalid");
  return burnIntent;
}

function requiredGatewaySignature(value: unknown) {
  const signature = requiredLimitedString(value, "signature", 512);
  if (!/^0x[a-fA-F0-9]+$/.test(signature)) throw new Error("signature must be hex");
  return signature;
}

function requiredGatewayDomain(chainId: number) {
  const domain = gatewayDomains.find((item) => item.chainId === chainId);
  if (!domain) throw new Error(`Chain ${chainId} is not supported by Nexora Gateway`);
  return domain;
}

function gatewayBytes32(address: string) {
  if (!isAddress(address)) throw new Error("Gateway address is not configured");
  return pad(address.toLowerCase() as Hex, {size: 32});
}

function gatewayAddressFromBytes32(value: string) {
  const address = `0x${value.slice(-40)}`;
  if (!isAddress(address)) throw new Error("Gateway bytes32 address is invalid");
  return address;
}

function gatewayApiUrl() {
  return config.gateway.apiUrl.replace(/\/+$/, "");
}

async function gatewayPost<T>(path: string, body: unknown): Promise<T> {
  const upstream = await fetch(`${gatewayApiUrl()}${path}`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(body)
  });
  return parseGatewayResponse<T>(upstream);
}

async function parseGatewayResponse<T>(upstream: Response): Promise<T> {
  const raw = await upstream.text().catch(() => "");
  const parsed = raw ? tryJson<T & {success?: boolean; error?: string; message?: string}>(raw) : {} as T;
  if (!upstream.ok || (parsed && typeof parsed === "object" && "success" in parsed && parsed.success === false)) {
    const error = gatewayUpstreamError(gatewayErrorMessage(parsed, raw, upstream.status));
    throw error;
  }
  return parsed as T;
}

function gatewayUpstreamError(message: string) {
  const error = new Error(message);
  (error as Error & {status?: number}).status = 502;
  return error;
}

function parseGatewayBalance(value: unknown) {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? roundUsdc(parsed) : 0;
}

function gatewayErrorMessage(parsed: unknown, raw: string, status: number) {
  if (parsed && typeof parsed === "object" && "error" in parsed && typeof (parsed as {error?: unknown}).error === "string") return (parsed as {error: string}).error;
  if (parsed && typeof parsed === "object" && "message" in parsed && typeof (parsed as {message?: unknown}).message === "string") return (parsed as {message: string}).message;
  return raw.trim() || `Gateway balance request failed: ${status}`;
}

function tryJson<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

async function simulateAgentPolicy(input: {operatorAddress: string; agentId: string; serviceId: string; units: number}) {
  const store = await readStore();
  const agent = store.agents.find((item) => isVisibleAgent(item) && (item.id === input.agentId || item.address?.toLowerCase() === input.agentId.toLowerCase()));
  if (!agent) throw new Error("agent wallet not found");
  if (agent.operatorAddress.toLowerCase() !== input.operatorAddress.toLowerCase()) throw new Error("agent operator wallet required");
  const service = visibleServicesForStore(store.services).find((item) => item.id === input.serviceId || String(item.chainServiceId) === input.serviceId);
  if (!service) throw new Error("service not found");
  const evaluation = evaluateAgentPolicy({
    agent,
    service,
    units: input.units,
    payments: store.payments
  });
  const amountUsdc = roundUsdc(service.pricePerUnitUsdc * input.units);
  return {
    allowed: evaluation.allowed,
    reason: evaluation.reason ?? null,
    remediation: evaluation.remediation ?? null,
    agent: {
      id: agent.id,
      address: agent.address,
      arcName: agent.arcName,
      dailyLimitUsdc: agent.policy.dailyLimitUsdc,
      transactionCapUsdc: agent.policy.transactionCapUsdc
    },
    service: {
      id: service.id,
      chainServiceId: service.chainServiceId,
      name: service.name,
      publisherAddress: service.publisherAddress,
      pricePerUnitUsdc: service.pricePerUnitUsdc
    },
    units: input.units,
    amountUsdc,
    dailySpentUsdc: evaluation.v2?.dailySpentUsdc ?? 0,
    weeklySpentUsdc: evaluation.v2?.weeklySpentUsdc ?? 0,
    monthlySpentUsdc: evaluation.v2?.monthlySpentUsdc ?? 0,
    remainingDailyUsdc: roundUsdc(Math.max(0, agent.policy.dailyLimitUsdc - (evaluation.v2?.dailySpentUsdc ?? 0))),
    requestHash: requestHashForSimulation(agent.id, service.id, input.units)
  };
}

async function createAgentApprovalRequest(input: {operatorAddress: string; agentId: string; serviceId: string; units: number; note?: string}) {
  const simulation = await simulateAgentPolicy(input);
  const result = await updateStore((store) => {
    const agent = store.agents.find((item) => isVisibleAgent(item) && (item.id === input.agentId || item.address?.toLowerCase() === input.agentId.toLowerCase()));
    const service = visibleServicesForStore(store.services).find((item) => item.id === input.serviceId || String(item.chainServiceId) === input.serviceId);
    if (!agent || !service) throw new Error("approval request target not found");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const record: AgentApprovalRequestRecord = {
      id: crypto.randomUUID(),
      operatorAddress: input.operatorAddress,
      agentId: agent.id,
      agentWallet: agent.address,
      serviceId: service.id,
      serviceName: service.name,
      publisherAddress: service.publisherAddress,
      amountUsdc: simulation.amountUsdc,
      units: input.units,
      requestHash: simulation.requestHash,
      simulation: {
        allowed: simulation.allowed,
        reason: simulation.reason,
        dailySpentUsdc: simulation.dailySpentUsdc,
        weeklySpentUsdc: simulation.weeklySpentUsdc,
        monthlySpentUsdc: simulation.monthlySpentUsdc
      },
      status: "pending",
      note: input.note ?? null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      decidedAt: null,
      expiresAt
    };
    store.approvalRequests.unshift(record);
    store.approvalRequests = store.approvalRequests.slice(0, 300);
    const notification = pushNotification(store, {
      operatorAddress: input.operatorAddress,
      title: "Agent approval requested",
      detail: `${service.name} · ${simulation.amountUsdc} USDC`,
      kind: "policy",
      actionHref: "/settings/policies"
    });
    return {record, notification};
  });
  await dispatchNotification({notification: result.notification, event: "policyAlerts"});
  return result.record;
}

async function decideAgentApprovalRequest(id: string, operatorAddress: string, status: "approved" | "rejected", note?: string) {
  const result = await updateStore((store) => {
    const request = store.approvalRequests.find((item) => item.id === id);
    if (!request) throw new Error("approval request not found");
    if (request.operatorAddress.toLowerCase() !== operatorAddress.toLowerCase()) throw new Error("approval request operator wallet required");
    if (request.status !== "pending") throw new Error("approval request is already decided");
    const now = new Date();
    if (request.expiresAt && Date.parse(request.expiresAt) <= now.getTime()) {
      request.status = "expired";
      request.updatedAt = now.toISOString();
      throw new Error("approval request has expired");
    }
    request.status = status;
    request.note = note ?? request.note ?? null;
    request.updatedAt = now.toISOString();
    request.decidedAt = now.toISOString();
    const notification = pushNotification(store, {
      operatorAddress,
      title: status === "approved" ? "Agent payment approved" : "Agent payment rejected",
      detail: `${request.serviceName} · ${request.amountUsdc} USDC`,
      kind: "policy",
      actionHref: "/settings/policies"
    });
    return {request, notification};
  });
  await dispatchNotification({notification: result.notification, event: "policyAlerts"});
  return result.request;
}

function requestHashForSimulation(agentId: string, serviceId: string, units: number) {
  const source = `${agentId}:${serviceId}:${units}:${Date.now()}:${crypto.randomUUID()}`;
  const encoded = Buffer.from(source).toString("hex").slice(0, 64).padEnd(64, "0");
  return `0x${encoded}`;
}

async function developerDashboard(address: string) {
  const store = await readStore();
  const lower = address.toLowerCase();
  const services = visibleServicesForStore(store.services).filter((service) => service.publisherAddress.toLowerCase() === lower);
  const serviceIds = new Set(services.map((service) => service.id));
  const payments = store.payments.filter((payment) => serviceIds.has(payment.serviceId) && payment.publisherAddress.toLowerCase() === lower);
  const escrows = store.escrows.filter((escrow) => escrow.creatorAddress.toLowerCase() === lower || escrow.counterpartyAddress.toLowerCase() === lower);
  const settled = payments.filter((payment) => payment.status === "settled");
  const hasAnalytics = isPlanActive(store.subscriptions, lower, "developer_analytics");
  const platformRevenue = settled.reduce((sum, payment) => sum + (payment.platformFeeUsdc ?? 0), 0);
  const grossRevenue = settled.reduce((sum, payment) => sum + (payment.grossAmountUsdc ?? payment.amountUsdc), 0);
  return {
    address,
    services,
    payments: hasAnalytics ? payments : [],
    escrows,
    access: {
      developerAnalytics: hasAnalytics
    },
    summary: {
      publishedServices: services.length,
      totalExecutions: settled.length,
      grossRevenueUsdc: hasAnalytics ? grossRevenue : 0,
      platformRevenueUsdc: hasAnalytics ? platformRevenue : 0,
      netRevenueUsdc: hasAnalytics ? grossRevenue - platformRevenue : 0,
      activeEscrows: escrows.filter((escrow) => escrow.status !== "released" && escrow.status !== "cancelled").length
    }
  };
}

function isPlanActive(subscriptions: Array<{operatorAddress: string; plan: string; status: string; currentPeriodEnd?: string | null}>, operator: string, plan: string) {
  const now = Date.now();
  return subscriptions.some((subscription) => (
    subscription.operatorAddress.toLowerCase() === operator
    && subscription.plan === plan
    && subscription.status === "active"
    && (!subscription.currentPeriodEnd || Date.parse(subscription.currentPeriodEnd) > now)
  ));
}

async function platformRevenueDashboard() {
  const store = await readStore();
  const onchain = await indexedAnalytics();
  const onchainSummary = onchain.summary;
  const treasuryBalance = await treasuryUsdcBalance();
  const visibleServices = visibleServicesForStore(store.services);
  const visibleAgents = store.agents.filter(isVisibleAgent);
  const visibleServiceIds = new Set(visibleServices.map((service) => service.id));
  const visibleAgentIds = new Set(visibleAgents.map((agent) => agent.id));
  const visibleAgentWallets = new Set(visibleAgents.flatMap(agentWalletAddresses));
  const visiblePayments = store.payments.filter((payment) => {
    if (!visibleServiceIds.has(payment.serviceId)) return false;
    if (payment.agentId && !visibleAgentIds.has(payment.agentId)) return false;
    if (payment.agentWallet && !visibleAgentWallets.has(payment.agentWallet.toLowerCase())) return false;
    return true;
  });
  const settledPayments = visiblePayments.filter((payment) => payment.status === "settled");
  const facilitatorVolume = store.facilitatorEvents
    .filter((event) => event.kind === "settle" && event.status === "success")
    .reduce((sum, event) => sum + (event.amountUsdc ?? 0), 0);
  const escrowRevenue = store.escrows
    .filter((escrow) => escrow.status === "released")
    .reduce((sum, escrow) => sum + escrow.platformFeeUsdc, 0);
  const marketplaceGross = settledPayments.reduce((sum, payment) => sum + (payment.grossAmountUsdc ?? payment.amountUsdc), 0);
  const marketplaceFees = settledPayments.reduce((sum, payment) => sum + (payment.platformFeeUsdc ?? 0), 0);
  const bookedSubscriptions = store.subscriptions.reduce((sum, subscription) => sum + subscription.amountUsdc, 0);
  const collectedSubscriptions = store.subscriptions
    .filter((subscription) => subscription.status === "active")
    .reduce((sum, subscription) => sum + subscription.amountUsdc, 0);
  const developerAnalyticsRevenue = store.subscriptions
    .filter((subscription) => subscription.status === "active" && subscription.plan === "developer_analytics")
    .reduce((sum, subscription) => sum + subscription.amountUsdc, 0);
  const premiumAutomationRevenue = store.subscriptions
    .filter((subscription) => subscription.status === "active" && subscription.plan === "premium_agent_automation")
    .reduce((sum, subscription) => sum + subscription.amountUsdc, 0);
  const indexedMarketplaceAvailable = onchainSummary.marketplaceSettlements > 0;
  const indexedEscrowAvailable = onchainSummary.escrowReleases > 0;
  const indexedSaveEarnAvailable = onchainSummary.saveEarnWithdrawals > 0;
  const selectedMarketplaceGross = indexedMarketplaceAvailable ? onchainSummary.marketplaceGrossUsdc : marketplaceGross;
  const selectedMarketplaceFees = indexedMarketplaceAvailable ? onchainSummary.marketplaceFeesUsdc : marketplaceFees;
  const selectedEscrowRevenue = indexedEscrowAvailable ? onchainSummary.escrowFeesUsdc : escrowRevenue;
  const selectedSaveEarnFees = indexedSaveEarnAvailable ? onchainSummary.saveEarnFeesUsdc : 0;
  const selectedSettlementCount = indexedMarketplaceAvailable ? onchainSummary.marketplaceSettlements : settledPayments.length;
  const selectedEscrowReleaseCount = indexedEscrowAvailable
    ? onchainSummary.escrowReleases
    : store.escrows.filter((escrow) => escrow.status === "released").length;
  const collectedFees = selectedMarketplaceFees + selectedEscrowRevenue + selectedSaveEarnFees + collectedSubscriptions;
  const policySaves = visibleAgents.filter((agent) => agent.policy.txHash).length;
  const treasury = config.contracts.treasury;
  const onchainFeeReceipts = onchain.recentEvents
    .filter((event) => event.feeUsdc && event.feeUsdc > 0)
    .map((event) => ({
      id: event.id,
      source: `onchain ${event.contract}`,
      label: onchainReceiptLabel(event),
      grossUsdc: event.amountUsdc ?? event.feeUsdc ?? 0,
      feeUsdc: event.feeUsdc ?? 0,
      netUsdc: Math.max(0, (event.amountUsdc ?? 0) - (event.feeUsdc ?? 0)),
      txHash: event.transactionHash,
      createdAt: event.createdAt
    }));
  const feeReceipts = [
    ...settledPayments
      .filter((payment) => payment.platformFeeUsdc && payment.platformFeeUsdc > 0)
      .map((payment) => ({
        id: payment.id,
        source: "x402 marketplace",
        label: payment.serviceName,
        grossUsdc: payment.grossAmountUsdc ?? payment.amountUsdc,
        feeUsdc: payment.platformFeeUsdc ?? 0,
        netUsdc: payment.publisherNetUsdc ?? 0,
        txHash: payment.txHash ?? null,
        createdAt: payment.settledAt ?? payment.createdAt
      })),
    ...store.escrows
      .filter((escrow) => escrow.status === "released" && escrow.platformFeeUsdc > 0)
      .map((escrow) => ({
        id: escrow.id,
        source: "escrow",
        label: escrow.title,
        grossUsdc: escrow.amountUsdc,
        feeUsdc: escrow.platformFeeUsdc,
        netUsdc: escrow.counterpartyNetUsdc,
        txHash: escrow.txHash ?? null,
        createdAt: escrow.releasedAt ?? escrow.createdAt
      })),
    ...store.subscriptions
      .filter((subscription) => subscription.status === "active" && subscription.amountUsdc > 0)
      .map((subscription) => ({
        id: subscription.id,
        source: "monthly plan",
        label: subscription.planName ?? subscription.plan,
        grossUsdc: subscription.amountUsdc,
        feeUsdc: subscription.amountUsdc,
        netUsdc: subscription.amountUsdc,
        txHash: subscription.txHash ?? null,
        createdAt: subscription.activatedAt ?? subscription.createdAt
      })),
    ...onchainFeeReceipts
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const dedupedFeeReceipts = dedupeFeeReceipts(feeReceipts);

  return {
    treasury,
    treasuryBalance,
    feeReceipts: dedupedFeeReceipts.slice(0, 40),
    onchain,
    summary: {
      totalPlatformRevenueUsdc: roundUsdc(collectedFees),
      analyticsSource: onchainSummary.indexedEvents > 0 ? "indexed" : "local",
      indexedEvents: onchainSummary.indexedEvents,
      marketplaceGrossUsdc: roundUsdc(selectedMarketplaceGross),
      facilitatorVolumeUsdc: roundUsdc(facilitatorVolume),
      marketplaceFeesUsdc: roundUsdc(selectedMarketplaceFees),
      escrowFeesUsdc: roundUsdc(selectedEscrowRevenue),
      saveEarnFeesUsdc: roundUsdc(selectedSaveEarnFees),
      saveEarnDepositVolumeUsdc: onchainSummary.saveEarnDepositVolumeUsdc,
      saveEarnWithdrawalVolumeUsdc: onchainSummary.saveEarnWithdrawalVolumeUsdc,
      subscriptionRevenueUsdc: roundUsdc(collectedSubscriptions),
      bookedPlanVolumeUsdc: roundUsdc(bookedSubscriptions),
      developerAnalyticsRevenueUsdc: roundUsdc(developerAnalyticsRevenue),
      premiumAutomationRevenueUsdc: roundUsdc(premiumAutomationRevenue),
      settledPayments: selectedSettlementCount,
      onchainMarketplaceSettlements: onchainSummary.marketplaceSettlements,
      onchainEscrowReleases: onchainSummary.escrowReleases,
      publishedServices: visibleServices.length,
      activeAgents: visibleAgents.filter((agent) => agent.address).length,
      policySaves: onchainSummary.policySaves > 0 ? onchainSummary.policySaves : policySaves
    },
    bySource: [
      {source: "x402 marketplace fees", revenueUsdc: roundUsdc(selectedMarketplaceFees), amountUsdc: roundUsdc(selectedMarketplaceFees), kind: "revenue", count: selectedSettlementCount},
      {source: "escrow fees", revenueUsdc: roundUsdc(selectedEscrowRevenue), amountUsdc: roundUsdc(selectedEscrowRevenue), kind: "revenue", count: selectedEscrowReleaseCount},
      {source: "Save/Earn fees", revenueUsdc: roundUsdc(selectedSaveEarnFees), amountUsdc: roundUsdc(selectedSaveEarnFees), kind: "revenue", count: onchainSummary.saveEarnWithdrawals},
      {source: "Developer analytics monthly", revenueUsdc: roundUsdc(developerAnalyticsRevenue), amountUsdc: roundUsdc(developerAnalyticsRevenue), kind: "revenue", count: store.subscriptions.filter((subscription) => subscription.status === "active" && subscription.plan === "developer_analytics").length},
      {source: "Premium agent automation monthly", revenueUsdc: roundUsdc(premiumAutomationRevenue), amountUsdc: roundUsdc(premiumAutomationRevenue), kind: "revenue", count: store.subscriptions.filter((subscription) => subscription.status === "active" && subscription.plan === "premium_agent_automation").length},
      {source: "other active plan revenue", revenueUsdc: roundUsdc(Math.max(0, collectedSubscriptions - developerAnalyticsRevenue - premiumAutomationRevenue)), amountUsdc: roundUsdc(Math.max(0, collectedSubscriptions - developerAnalyticsRevenue - premiumAutomationRevenue)), kind: "revenue", count: store.subscriptions.filter((subscription) => subscription.status === "active" && subscription.plan !== "developer_analytics" && subscription.plan !== "premium_agent_automation").length},
      {source: "booked plan volume", revenueUsdc: 0, amountUsdc: roundUsdc(bookedSubscriptions), kind: "volume", count: store.subscriptions.length},
      {source: "x402 facilitator volume", revenueUsdc: 0, amountUsdc: roundUsdc(facilitatorVolume), kind: "volume", count: store.facilitatorEvents.filter((event) => event.kind === "settle" && event.status === "success").length},
      {source: "Save/Earn deposit volume", revenueUsdc: 0, amountUsdc: onchainSummary.saveEarnDepositVolumeUsdc, kind: "volume", count: onchainSummary.saveEarnDeposits},
      {source: "Save/Earn withdrawal volume", revenueUsdc: 0, amountUsdc: onchainSummary.saveEarnWithdrawalVolumeUsdc, kind: "volume", count: onchainSummary.saveEarnWithdrawals},
      {source: "Swap fees", revenueUsdc: 0, amountUsdc: 0, kind: "revenue", count: 0}
    ]
  };
}

function onchainReceiptLabel(event: {event: string; actor?: string | null; counterparty?: string | null}) {
  if (event.event === "RequestSettled" || event.event === "AgentRequestSettled") return "x402 settlement";
  if (event.event === "EscrowReleased") return "Escrow release";
  if (event.event === "Withdrawn") return "Save/Earn withdrawal";
  return event.event;
}

function dedupeFeeReceipts<T extends {id: string; txHash?: string | null; source: string}>(receipts: T[]) {
  const seen = new Set<string>();
  return receipts.filter((receipt) => {
    const key = receipt.txHash ? `tx:${receipt.txHash.toLowerCase()}:${receipt.source}` : `id:${receipt.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function verifyPlanPayment(input: {operatorAddress: string; plan: string; txHash: string; chainId: number}) {
  if (input.chainId !== config.arc.chainId) {
    throw new Error("plan payments are currently accepted on Arc Testnet");
  }
  if (!isAddress(config.contracts.treasury) || !isAddress(config.contracts.usdc)) {
    throw new Error("treasury payment address is not configured");
  }
  const plan = requirePlatformPlan(input.plan);
  const publicClient = arcPublicClient();
  const receipt = await publicClient.getTransactionReceipt({hash: input.txHash as `0x${string}`});
  if (receipt.status !== "success") throw new Error("plan payment transaction reverted");

  const minimumAmount = BigInt(Math.round(plan.amountUsdc * 1_000_000));
  const treasury = config.contracts.treasury.toLowerCase();
  const operator = input.operatorAddress.toLowerCase();
  const usdc = config.contracts.usdc.toLowerCase();
  const paid = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== usdc) return false;
    try {
      const parsed = parseErc20TransferLog(log);
      return parsed.from.toLowerCase() === operator
        && parsed.to.toLowerCase() === treasury
        && parsed.value >= minimumAmount;
    } catch {
      return false;
    }
  });

  if (!paid) {
    throw new Error(`transaction does not include the required ${plan.amountUsdc} USDC transfer to Nexora treasury`);
  }
}

function parseErc20TransferLog(log: {topics: readonly `0x${string}`[]; data: `0x${string}`}) {
  const eventTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  if (log.topics[0]?.toLowerCase() !== eventTopic) throw new Error("not transfer");
  const from = topicAddress(log.topics[1]);
  const to = topicAddress(log.topics[2]);
  const value = BigInt(log.data);
  return {from, to, value};
}

function topicAddress(topic?: `0x${string}`) {
  if (!topic || topic.length !== 66) throw new Error("invalid indexed address");
  return `0x${topic.slice(26)}`;
}

function arcPublicClient() {
  return createPublicClient({
    transport: http(config.arc.rpcUrl),
    chain: {
      id: config.arc.chainId,
      name: "Arc Testnet",
      nativeCurrency: {name: "USDC", symbol: "USDC", decimals: 18},
      rpcUrls: {default: {http: [config.arc.rpcUrl]}}
    }
  });
}

async function treasuryUsdcBalance() {
  if (!isAddress(config.contracts.treasury) || !isAddress(config.contracts.usdc)) {
    return {
      available: false,
      balanceUsdc: 0,
      asset: config.contracts.usdc,
      treasury: config.contracts.treasury,
      updatedAt: new Date().toISOString()
    };
  }

  try {
    const publicClient = arcPublicClient();
    const raw = await publicClient.readContract({
      address: config.contracts.usdc as `0x${string}`,
      abi: erc20BalanceAbi,
      functionName: "balanceOf",
      args: [config.contracts.treasury as `0x${string}`]
    });
    return {
      available: true,
      balanceUsdc: roundUsdc(Number(formatUnits(raw, 6))),
      asset: config.contracts.usdc,
      treasury: config.contracts.treasury,
      updatedAt: new Date().toISOString()
    };
  } catch {
    return {
      available: false,
      balanceUsdc: 0,
      asset: config.contracts.usdc,
      treasury: config.contracts.treasury,
      updatedAt: new Date().toISOString()
    };
  }
}

async function facilitatorAnalytics() {
  const store = await readStore();
  const events = store.facilitatorEvents;
  const verifyEvents = events.filter((event) => event.kind === "verify");
  const settleEvents = events.filter((event) => event.kind === "settle");
  const successfulSettles = settleEvents.filter((event) => event.status === "success");
  const activeIntegrators = new Set(successfulSettles.map((event) => event.payTo?.toLowerCase()).filter(Boolean)).size;
  return {
    summary: {
      verifications: verifyEvents.length,
      settlements: successfulSettles.length,
      failed: events.filter((event) => event.status === "failed").length,
      volumeUsdc: roundUsdc(successfulSettles.reduce((sum, event) => sum + (event.amountUsdc ?? 0), 0)),
      activeIntegrators
    },
    recentEvents: events.slice(-40).reverse()
  };
}

async function publicBuilderDirectory() {
  const store = await readStore();
  const byPublisher = new Map<string, typeof store.services>();
  for (const service of visibleServicesForStore(store.services)) {
    const key = service.publisherAddress.toLowerCase();
    byPublisher.set(key, [...(byPublisher.get(key) ?? []), service]);
  }

  const builders = [...byPublisher.entries()].map(([address, services]) => {
    const serviceIds = new Set(services.map((service) => service.id));
    const settled = store.payments.filter((payment) => serviceIds.has(payment.serviceId) && payment.publisherAddress.toLowerCase() === address && payment.status === "settled");
    const fees = settled.reduce((sum, payment) => sum + (payment.platformFeeUsdc ?? 0), 0);
    const gross = settled.reduce((sum, payment) => sum + (payment.grossAmountUsdc ?? payment.amountUsdc), 0);
    return {
      address: services[0]?.publisherAddress ?? address,
      services,
      serviceCount: services.length,
      settledPayments: settled.length,
      grossVolumeUsdc: roundUsdc(gross),
      platformFeesUsdc: roundUsdc(fees),
      featured: services.some((service) => service.featured),
      firstPublishedAt: services.map((service) => service.createdAt).sort()[0] ?? null
    };
  });

  builders.sort((a, b) => Number(b.featured) - Number(a.featured) || b.settledPayments - a.settledPayments || b.serviceCount - a.serviceCount);
  return {builders};
}

async function publicReceipt(id: string) {
  const normalized = id.trim();
  if (!normalized) {
    const error = new Error("receipt id is required");
    (error as Error & {status?: number}).status = 400;
    throw error;
  }

  const store = await readStore();
  const payment = store.payments.find((item) => matchesReceiptId(normalized, [
    item.id,
    item.authorizationId,
    item.txHash,
    item.requestHash
  ]));
  if (payment) return paymentReceipt(payment);

  const escrow = store.escrows.find((item) => matchesReceiptId(normalized, [
    item.id,
    item.txHash,
    item.chainEscrowId === undefined || item.chainEscrowId === null ? null : String(item.chainEscrowId)
  ]));
  if (escrow) return escrowReceipt(escrow);

  const subscription = store.subscriptions.find((item) => matchesReceiptId(normalized, [item.id, item.txHash]));
  if (subscription) return subscriptionReceipt(subscription);

  const indexed = store.indexedEvents.find((event) => matchesReceiptId(normalized, [
    event.id,
    event.transactionHash,
    `${event.chainId}:${event.transactionHash}:${event.logIndex}`
  ]));
  if (indexed) return indexedEventReceipt(indexed);

  const error = new Error("receipt not found");
  (error as Error & {status?: number}).status = 404;
  throw error;
}

function paymentReceipt(payment: PaymentRecord) {
  const status = payment.status;
  const external = payment.external ?? null;
  const chainId = external?.chainId ?? config.arc.chainId;
  const publicNote = payment.policyReason
    ?? (external
      ? "This receipt records a Circle Agent Marketplace x402 payment executed by the Circle CLI. The paid service response is visible only to the payer at execution time."
      : !payment.txHash && status === "settled"
      ? "This receipt records an off-chain/test x402 settlement. No Arc transaction hash was attached, so no treasury transfer can be verified on Arc Explorer."
      : null);
  return {
    id: payment.id,
    kind: external ? "circle_agent_marketplace_payment" : "x402_payment",
    title: payment.serviceName,
    description: receiptDescription(status, external ? "Circle agent marketplace payment" : "x402 marketplace payment"),
    status,
    amountUsdc: roundUsdc(payment.grossAmountUsdc ?? payment.amountUsdc),
    feeUsdc: roundUsdc(payment.platformFeeUsdc ?? 0),
    netUsdc: roundUsdc(payment.publisherNetUsdc ?? Math.max(0, payment.amountUsdc - (payment.platformFeeUsdc ?? 0))),
    units: payment.units,
    payer: payment.payer,
    publisherAddress: payment.publisherAddress,
    agentWallet: payment.agentWallet ?? null,
    serviceId: payment.serviceId,
    requestHash: payment.requestHash,
    txHash: payment.txHash ?? null,
    chainId,
    network: external?.network ?? chainName(chainId),
    explorerUrl: explorerTxUrl(explorerForChain(chainId), payment.txHash),
    external: external ? {
      provider: external.provider,
      serviceUrl: external.serviceUrl,
      chain: external.chain,
      paymentScheme: external.paymentScheme ?? null,
      resultSummary: external.resultSummary ?? null
    } : null,
    memo: publicMemoView(payment.memo),
    memoBacked: Boolean(payment.memo?.arc.memoIndex !== null && payment.memo?.arc.memoIndex !== undefined),
    createdAt: payment.createdAt,
    settledAt: payment.settledAt ?? null,
    publicNote
  };
}

async function agentFinancialMemory(operatorAddress: string) {
  const store = await readStore();
  const operator = operatorAddress.toLowerCase();
  const agents = store.agents.filter((agent) => isVisibleAgent(agent) && agent.operatorAddress.toLowerCase() === operator);
  const agentIds = new Set(agents.map((agent) => agent.id));
  const agentWallets = new Set(agents.flatMap(agentWalletAddresses));
  const visibleServiceIds = new Set(visibleServicesForStore(store.services).map((service) => service.id));
  const payments = store.payments
    .filter((payment) => (
      (payment.external || visibleServiceIds.has(payment.serviceId))
      && (
        payment.payer.toLowerCase() === operator
        || Boolean(payment.agentId && agentIds.has(payment.agentId))
        || Boolean(payment.agentWallet && agentWallets.has(payment.agentWallet.toLowerCase()))
      )
    ))
    .sort((a, b) => Date.parse(b.settledAt ?? b.createdAt) - Date.parse(a.settledAt ?? a.createdAt));

  const settled = payments.filter((payment) => payment.status === "settled");
  const blocked = payments.filter((payment) => payment.status === "policy_blocked");
  const byBucket = new Map<string, {budgetBucket: string; totalUsdc: number; payments: number; settled: number; blocked: number}>();
  const byService = new Map<string, {serviceId: string; serviceName: string; totalUsdc: number; payments: number; settled: number; lastUsedAt: string}>();
  const byIntent = new Map<string, {intent: string; totalUsdc: number; payments: number; latestAt: string}>();

  for (const payment of payments) {
    const memo = paymentMemoSummary(payment);
    const bucket = byBucket.get(memo.budgetBucket) ?? {budgetBucket: memo.budgetBucket, totalUsdc: 0, payments: 0, settled: 0, blocked: 0};
    bucket.totalUsdc = roundUsdc(bucket.totalUsdc + (payment.status === "settled" ? payment.amountUsdc : 0));
    bucket.payments += 1;
    if (payment.status === "settled") bucket.settled += 1;
    if (payment.status === "policy_blocked") bucket.blocked += 1;
    byBucket.set(bucket.budgetBucket, bucket);

    const service = byService.get(payment.serviceId) ?? {
      serviceId: payment.serviceId,
      serviceName: payment.serviceName,
      totalUsdc: 0,
      payments: 0,
      settled: 0,
      lastUsedAt: payment.settledAt ?? payment.createdAt
    };
    service.totalUsdc = roundUsdc(service.totalUsdc + (payment.status === "settled" ? payment.amountUsdc : 0));
    service.payments += 1;
    if (payment.status === "settled") service.settled += 1;
    if (Date.parse(payment.settledAt ?? payment.createdAt) > Date.parse(service.lastUsedAt)) service.lastUsedAt = payment.settledAt ?? payment.createdAt;
    byService.set(payment.serviceId, service);

    const intent = byIntent.get(memo.intent) ?? {intent: memo.intent, totalUsdc: 0, payments: 0, latestAt: payment.settledAt ?? payment.createdAt};
    intent.totalUsdc = roundUsdc(intent.totalUsdc + (payment.status === "settled" ? payment.amountUsdc : 0));
    intent.payments += 1;
    if (Date.parse(payment.settledAt ?? payment.createdAt) > Date.parse(intent.latestAt)) intent.latestAt = payment.settledAt ?? payment.createdAt;
    byIntent.set(memo.intent, intent);
  }

  const recentMemories = payments.slice(0, 40).map((payment) => {
    const memo = paymentMemoSummary(payment);
    return {
      paymentId: payment.id,
      authorizationId: payment.authorizationId ?? null,
      memoId: memo.memoId,
      serviceId: payment.serviceId,
      serviceName: payment.serviceName,
      status: payment.status,
      amountUsdc: roundUsdc(payment.amountUsdc),
      budgetBucket: memo.budgetBucket,
      intent: memo.intent,
      privacyScope: memo.privacyScope,
      requestHash: payment.requestHash,
      txHash: payment.txHash ?? null,
      createdAt: payment.createdAt,
      settledAt: payment.settledAt ?? null
    };
  });

  return {
    operatorAddress,
    agents: agents.map((agent) => ({
      id: agent.id,
      arcName: agent.arcName,
      address: agent.address,
      dailyLimitUsdc: agent.policy.dailyLimitUsdc,
      transactionCapUsdc: agent.policy.transactionCapUsdc
    })),
    summary: {
      totalPayments: payments.length,
      settledPayments: settled.length,
      blockedPayments: blocked.length,
      totalSpentUsdc: roundUsdc(settled.reduce((sum, payment) => sum + payment.amountUsdc, 0)),
      memoBackedPayments: payments.filter((payment) => Boolean(payment.memo?.memoId)).length,
      uniqueServices: new Set(payments.map((payment) => payment.serviceId)).size,
      budgetBuckets: byBucket.size
    },
    byBudgetBucket: [...byBucket.values()].sort((a, b) => b.totalUsdc - a.totalUsdc || b.payments - a.payments),
    byService: [...byService.values()].sort((a, b) => b.totalUsdc - a.totalUsdc || Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt)).slice(0, 20),
    byIntent: [...byIntent.values()].sort((a, b) => b.totalUsdc - a.totalUsdc || Date.parse(b.latestAt) - Date.parse(a.latestAt)).slice(0, 20),
    recentMemories
  };
}

function escrowReceipt(escrow: EscrowRecord) {
  return {
    id: escrow.id,
    kind: "escrow",
    title: escrow.title,
    description: receiptDescription(escrow.status, "USDC work escrow"),
    status: escrow.status,
    amountUsdc: roundUsdc(escrow.amountUsdc),
    feeUsdc: roundUsdc(escrow.platformFeeUsdc),
    netUsdc: roundUsdc(escrow.counterpartyNetUsdc),
    creatorAddress: escrow.creatorAddress,
    counterpartyAddress: escrow.counterpartyAddress,
    chainEscrowId: escrow.chainEscrowId ?? null,
    txHash: escrow.txHash ?? null,
    chainId: config.arc.chainId,
    network: "Arc Testnet",
    explorerUrl: explorerTxUrl(config.arc.explorerUrl, escrow.txHash),
    createdAt: escrow.createdAt,
    fundedAt: escrow.fundedAt ?? null,
    submittedAt: escrow.submittedAt ?? null,
    verifiedAt: escrow.verifiedAt ?? null,
    releasedAt: escrow.releasedAt ?? null
  };
}

function subscriptionReceipt(subscription: SubscriptionRecord) {
  return {
    id: subscription.id,
    kind: "subscription",
    title: subscription.planName ?? subscription.plan,
    description: receiptDescription(subscription.status, "Nexora plan payment"),
    status: subscription.status,
    amountUsdc: roundUsdc(subscription.amountUsdc),
    feeUsdc: roundUsdc(subscription.amountUsdc),
    netUsdc: roundUsdc(subscription.amountUsdc),
    operatorAddress: subscription.operatorAddress,
    plan: subscription.plan,
    interval: subscription.interval ?? "month",
    txHash: subscription.txHash ?? null,
    chainId: subscription.chainId ?? config.arc.chainId,
    network: chainName(subscription.chainId ?? config.arc.chainId),
    explorerUrl: explorerTxUrl(explorerForChain(subscription.chainId ?? config.arc.chainId), subscription.txHash),
    createdAt: subscription.createdAt,
    activatedAt: subscription.activatedAt ?? null,
    currentPeriodStart: subscription.currentPeriodStart ?? null,
    currentPeriodEnd: subscription.currentPeriodEnd ?? null
  };
}

function indexedEventReceipt(event: IndexedChainEventRecord) {
  return {
    id: event.id,
    kind: `onchain_${event.contract}`,
    title: onchainReceiptLabel(event),
    description: receiptDescription("indexed", `${event.contract} ${event.event}`),
    status: "indexed",
    amountUsdc: roundUsdc(event.amountUsdc ?? 0),
    feeUsdc: roundUsdc(event.feeUsdc ?? 0),
    netUsdc: roundUsdc(Math.max(0, (event.amountUsdc ?? 0) - (event.feeUsdc ?? 0))),
    actor: event.actor ?? null,
    counterparty: event.counterparty ?? null,
    event: event.event,
    contract: event.contract,
    contractAddress: event.address,
    blockNumber: event.blockNumber,
    logIndex: event.logIndex,
    txHash: event.transactionHash,
    chainId: event.chainId,
    network: chainName(event.chainId),
    explorerUrl: explorerTxUrl(explorerForChain(event.chainId), event.transactionHash),
    createdAt: event.createdAt
  };
}

function matchesReceiptId(input: string, values: Array<string | null | undefined>) {
  const normalized = input.toLowerCase();
  return values.some((value) => value && value.toLowerCase() === normalized);
}

function receiptDescription(status: string, fallback: string) {
  if (status === "settled") return "Settled x402 payment receipt.";
  if (status === "released") return "Released escrow payment receipt.";
  if (status === "active") return "Active Nexora plan receipt.";
  if (status === "policy_blocked") return "Policy-blocked x402 payment record.";
  return fallback;
}

function explorerForChain(chainId: number) {
  if (chainId === config.base.sepoliaChainId) return config.base.sepoliaExplorerUrl;
  if (chainId === config.base.mainnetChainId) return config.base.mainnetExplorerUrl;
  if (chainId === config.arbitrum.sepoliaChainId) return config.arbitrum.sepoliaExplorerUrl;
  if (chainId === config.arbitrum.oneChainId) return config.arbitrum.oneExplorerUrl;
  if (chainId === 137) return "https://polygonscan.com";
  if (chainId === 1) return "https://etherscan.io";
  if (chainId === 10) return "https://optimistic.etherscan.io";
  if (chainId === 43114) return "https://snowtrace.io";
  return config.arc.explorerUrl;
}

function chainName(chainId: number) {
  if (chainId === config.base.sepoliaChainId) return "Base Sepolia";
  if (chainId === config.base.mainnetChainId) return "Base";
  if (chainId === config.arbitrum.sepoliaChainId) return "Arbitrum Sepolia";
  if (chainId === config.arbitrum.oneChainId) return "Arbitrum One";
  if (chainId === 137) return "Polygon";
  if (chainId === 1) return "Ethereum";
  if (chainId === 10) return "Optimism";
  if (chainId === 43114) return "Avalanche";
  return "Arc Testnet";
}

function explorerTxUrl(explorerUrl: string, txHash?: string | null) {
  if (!txHash) return null;
  return `${explorerUrl.replace(/\/$/, "")}/tx/${txHash}`;
}

async function deploymentDashboard() {
  const store = await readStore();
  const settledPayments = store.payments.filter((payment) => payment.status === "settled");
  const escrowFees = store.escrows
    .filter((escrow) => escrow.status === "released")
    .reduce((sum, escrow) => sum + escrow.platformFeeUsdc, 0);
  const marketplaceFees = settledPayments.reduce((sum, payment) => sum + (payment.platformFeeUsdc ?? 0), 0);
  const planRevenue = store.subscriptions
    .filter((subscription) => subscription.status === "active")
    .reduce((sum, subscription) => sum + subscription.amountUsdc, 0);
  const developerAnalyticsRevenue = store.subscriptions
    .filter((subscription) => subscription.status === "active" && subscription.plan === "developer_analytics")
    .reduce((sum, subscription) => sum + subscription.amountUsdc, 0);
  const premiumAutomationRevenue = store.subscriptions
    .filter((subscription) => subscription.status === "active" && subscription.plan === "premium_agent_automation")
    .reduce((sum, subscription) => sum + subscription.amountUsdc, 0);
  const bookedPlanVolume = store.subscriptions.reduce((sum, subscription) => sum + subscription.amountUsdc, 0);

  return {
    treasury: {
      address: config.contracts.treasury,
      totalPlatformRevenueUsdc: roundUsdc(marketplaceFees + escrowFees + planRevenue),
      marketplaceFeesUsdc: roundUsdc(marketplaceFees),
      escrowFeesUsdc: roundUsdc(escrowFees),
      planRevenueUsdc: roundUsdc(planRevenue),
      developerAnalyticsRevenueUsdc: roundUsdc(developerAnalyticsRevenue),
      premiumAutomationRevenueUsdc: roundUsdc(premiumAutomationRevenue),
      bookedPlanVolumeUsdc: roundUsdc(bookedPlanVolume)
    },
    fees: {
      x402DefaultBps: 200,
      escrowDefaultBps: 100,
      saveEarnWithdrawalBps: Number(process.env.NEXORA_WITHDRAWAL_FEE_BPS ?? 100),
      deploymentFeeBps: Number(process.env.NEXORA_FEE_BPS ?? 250),
      editable: false
    },
    chains: [
      {
        key: "arc-testnet",
        primary: true,
        name: "Arc Testnet",
        chainId: config.arc.chainId,
        rpcUrl: config.arc.rpcUrl,
        explorerUrl: config.arc.explorerUrl,
        usdc: config.contracts.usdc,
        contracts: {
          policyRegistry: config.contracts.policyRegistry,
          reputation: config.contracts.reputation,
          x402Ledger: config.contracts.x402Ledger,
          yieldRouter: config.contracts.yieldRouter,
          saveEarnVault: config.contracts.saveEarnVault,
          nexoraEscrow: config.contracts.nexoraEscrow
        },
        features: ["Agent policies", "x402 marketplace", "Save/Earn", "Escrow", "Swap aggregator"]
      },
      {
        key: "arbitrum-sepolia",
        primary: false,
        name: "Arbitrum Sepolia",
        chainId: config.arbitrum.sepoliaChainId,
        rpcUrl: config.arbitrum.sepoliaRpcUrl,
        explorerUrl: config.arbitrum.sepoliaExplorerUrl,
        usdc: config.arbitrum.sepoliaUsdc,
        contracts: {
          policyRegistry: config.arbitrum.sepoliaPolicyRegistry,
          reputation: config.arbitrum.sepoliaReputation,
          x402Ledger: config.arbitrum.sepoliaX402Ledger,
          yieldRouter: config.arbitrum.sepoliaYieldRouter,
          saveEarnVault: config.arbitrum.sepoliaSaveEarnVault,
          nexoraEscrow: config.arbitrum.sepoliaEscrow
        },
        features: ["Agent policies", "x402 marketplace", "Save/Earn", "Escrow"]
      },
      {
        key: "base-sepolia",
        primary: false,
        name: "Base Sepolia",
        chainId: config.base.sepoliaChainId,
        rpcUrl: config.base.sepoliaRpcUrl,
        explorerUrl: config.base.sepoliaExplorerUrl,
        usdc: config.base.sepoliaUsdc,
        contracts: {
          policyRegistry: config.base.sepoliaPolicyRegistry,
          reputation: config.base.sepoliaReputation,
          x402Ledger: config.base.sepoliaX402Ledger,
          yieldRouter: config.base.sepoliaYieldRouter,
          saveEarnVault: config.base.sepoliaSaveEarnVault,
          nexoraEscrow: config.base.sepoliaEscrow
        },
        features: ["Agent policies", "x402 marketplace", "Save/Earn", "Escrow"]
      }
    ]
  };
}

async function createEscrow(input: {
  creatorAddress: string;
  counterpartyAddress: string;
  title: string;
  description: string;
  amountUsdc: number;
  performanceBondUsdc: number;
  platformFeeBps: number;
  chainEscrowId?: number;
  txHash?: string;
}) {
  const result = await updateStore((store) => {
    const platformFeeUsdc = roundUsdc((input.amountUsdc * input.platformFeeBps) / 10_000);
    const escrow = {
      id: crypto.randomUUID(),
      chainEscrowId: input.chainEscrowId ?? null,
      creatorAddress: input.creatorAddress,
      counterpartyAddress: input.counterpartyAddress,
      title: input.title,
      description: input.description,
      amountUsdc: input.amountUsdc,
      performanceBondUsdc: input.performanceBondUsdc,
      platformFeeBps: input.platformFeeBps,
      platformFeeUsdc,
      counterpartyNetUsdc: roundUsdc(input.amountUsdc - platformFeeUsdc),
      status: "draft" as const,
      createdAt: new Date().toISOString(),
      txHash: input.txHash ?? null
    };
    store.escrows.push(escrow);
    const creatorNotification = pushNotification(store, {
      operatorAddress: input.creatorAddress,
      title: "Escrow created",
      detail: `${input.amountUsdc} USDC for ${input.title}`,
      kind: "escrow",
      txHash: input.txHash ?? null,
      receiptId: escrow.id,
      actionHref: `/receipts/${encodeURIComponent(escrow.id)}`
    });
    const counterpartyNotification = pushNotification(store, {
      operatorAddress: input.counterpartyAddress,
      title: "Escrow assigned",
      detail: `${input.amountUsdc} USDC task: ${input.title}`,
      kind: "escrow",
      txHash: input.txHash ?? null,
      receiptId: escrow.id,
      actionHref: `/receipts/${encodeURIComponent(escrow.id)}`
    });
    return {escrow, notifications: [creatorNotification, counterpartyNotification]};
  });
  for (const notification of result.notifications) {
    await dispatchNotification({notification, event: "escrowUpdates", receiptId: result.escrow.id}).catch(() => undefined);
  }
  return result.escrow;
}

async function removeEscrow(escrowId: string, operatorAddress: string) {
  return updateStore((store) => {
    const escrowIndex = store.escrows.findIndex((item) => item.id === escrowId);
    if (escrowIndex === -1) throw new Error("escrow not found");

    const escrow = store.escrows[escrowIndex];
    const operator = operatorAddress.toLowerCase();
    const canRemove = escrow.creatorAddress.toLowerCase() === operator || escrow.counterpartyAddress.toLowerCase() === operator;
    if (!canRemove) throw new Error("Only the creator or counterparty can remove this escrow from their workspace.");
    if (!["draft", "released", "cancelled"].includes(escrow.status)) {
      throw new Error("Only draft, released, or cancelled escrows can be removed from the workspace.");
    }

    store.escrows.splice(escrowIndex, 1);
    pushNotification(store, {
      operatorAddress,
      title: "Escrow removed",
      detail: escrow.title,
      kind: "escrow"
    });
    return {removed: true, escrowId};
  });
}

async function updateEscrow(
  escrowId: string,
  status: "funded" | "submitted" | "verified" | "released",
  fields: Record<string, string | boolean | undefined>,
  auth: AuthContext
) {
  const operatorAddress = requiredAddress(fields.operatorAddress, "operatorAddress");
  assertTokenAddress(auth, operatorAddress, "operatorAddress");
  const autoResult = status === "submitted" && fields.autoExecute ? await runEscrowAgentSafe(escrowId) : null;
  const result = await updateStore((store) => {
    const escrow = store.escrows.find((item) => item.id === escrowId);
    if (!escrow) throw new Error("escrow not found");
    assertEscrowRole(escrow, operatorAddress, status);
    escrow.status = status;
    if (typeof fields.txHash === "string") escrow.txHash = fields.txHash;
    if (typeof fields.deliverableUrl === "string") escrow.deliverableUrl = fields.deliverableUrl;
    if (typeof fields.verifierNotes === "string") escrow.verifierNotes = fields.verifierNotes;
    if (autoResult) {
      escrow.deliverableUrl = autoResult.deliverableUrl;
      escrow.deliverableResult = autoResult.result;
    }
    const now = new Date().toISOString();
    if (status === "funded") escrow.fundedAt = now;
    if (status === "submitted") escrow.submittedAt = now;
    if (status === "verified") escrow.verifiedAt = now;
    if (status === "released") escrow.releasedAt = now;
    const title = status === "funded"
      ? "Escrow funded"
      : status === "submitted"
        ? "Escrow deliverable submitted"
        : status === "verified"
          ? "Escrow verified"
          : "Escrow released";
    const creatorNotification = pushNotification(store, {
      operatorAddress: escrow.creatorAddress,
      title,
      detail: escrow.title,
      kind: "escrow",
      txHash: escrow.txHash ?? null,
      receiptId: escrow.id,
      actionHref: `/receipts/${encodeURIComponent(escrow.id)}`
    });
    const counterpartyNotification = pushNotification(store, {
      operatorAddress: escrow.counterpartyAddress,
      title,
      detail: escrow.title,
      kind: "escrow",
      txHash: escrow.txHash ?? null,
      receiptId: escrow.id,
      actionHref: `/receipts/${encodeURIComponent(escrow.id)}`
    });
    return {escrow, notifications: [creatorNotification, counterpartyNotification]};
  });
  for (const notification of result.notifications) {
    await dispatchNotification({notification, event: "escrowUpdates", receiptId: result.escrow.id}).catch(() => undefined);
  }
  return result.escrow;
}

function assertEscrowRole(
  escrow: {creatorAddress: string; counterpartyAddress: string},
  operatorAddress: string,
  action: "funded" | "submitted" | "verified" | "released"
) {
  const operator = operatorAddress.toLowerCase();
  const creator = escrow.creatorAddress.toLowerCase();
  const counterparty = escrow.counterpartyAddress.toLowerCase();
  if (action === "submitted") {
    if (operator !== counterparty) throw new Error("Only the counterparty can submit this escrow deliverable.");
    return;
  }
  if (operator !== creator) throw new Error("Only the escrow creator can perform this action.");
}

function roundUsdc(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

async function runEscrowAgent(escrowId: string) {
  const store = await readStore();
  const escrow = store.escrows.find((item) => item.id === escrowId);
  if (!escrow) throw new Error("escrow not found");
  const text = `${escrow.title}\n${escrow.description}`;
  const github = cleanExtractedValue(text.match(/github\.com\/[^\s)]+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i)?.[0]);
  const url = cleanExtractedValue(text.match(/https?:\/\/[^\s)]+/i)?.[0]);
  const xHandle = text.match(/@[A-Za-z0-9_]{1,15}/)?.[0];

  if (github && /github\.com\/|^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(github)) {
    return {
      deliverableUrl: `nexora://escrows/${escrowId}/github-analysis`,
      result: {
        kind: "github_repo_analyzer",
        input: {repo: github},
        output: await executeBuiltInService("github_repo_analyzer", {repo: github})
      }
    };
  }

  if (url) {
    return {
      deliverableUrl: `nexora://escrows/${escrowId}/website-analysis`,
      result: {
        kind: "website_analyzer",
        input: {url},
        output: await executeBuiltInService("website_analyzer", {url})
      }
    };
  }

  if (xHandle) {
    return {
      deliverableUrl: `nexora://escrows/${escrowId}/x-analysis`,
      result: {
        kind: "x_account_analyzer",
        input: {handle: xHandle},
        output: await executeBuiltInService("x_account_analyzer", {handle: xHandle})
      }
    };
  }

  return {
    deliverableUrl: `nexora://escrows/${escrowId}/manual-deliverable`,
    result: {
      kind: "generic",
      input: {description: escrow.description},
      output: {
        status: "manual_review",
        summary: "No URL, GitHub repository, or X handle was found in the escrow details. Attach a manual deliverable."
      }
    }
  };
}

async function runEscrowAgentSafe(escrowId: string) {
  try {
    return await runEscrowAgent(escrowId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent execution failed";
    return {
      deliverableUrl: `nexora://escrows/${escrowId}/agent-error`,
      result: {
        kind: "agent_error",
        input: {escrowId},
        output: {
          status: "error",
          summary: "The on-chain submission succeeded, but Nexora could not complete the automatic agent analysis.",
          message
        }
      }
    };
  }
}

function cleanExtractedValue(value: string | undefined) {
  return value?.replace(/[.,;:!?]+$/g, "");
}

function normalizePath(path: string) {
  if (path === "/") return "/api/health";
  if (path === "/health") return "/api/health";
  if (path.startsWith("/api/")) return path;
  return `/api${path}`;
}
