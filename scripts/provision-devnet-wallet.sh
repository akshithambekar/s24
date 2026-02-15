#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# provision-devnet-wallet.sh
# Reads wallet-keypair.json (Solana Playground format), derives the public key,
# and stores the keypair in AWS Secrets Manager for the API to use.
#
# After running, manually airdrop devnet SOL at https://faucet.solana.com/
# ---------------------------------------------------------------------------

REGION="${AWS_REGION:-us-east-1}"
SECRET_ID="solana-autopilot-infra/devnet-wallet"
KEYPAIR_FILE="${1:-wallet-keypair.json}"

if [[ ! -f "$KEYPAIR_FILE" ]]; then
  echo "ERROR: Keypair file not found: $KEYPAIR_FILE"
  echo "Usage: $0 [path-to-wallet-keypair.json]"
  exit 1
fi

echo "Reading keypair from $KEYPAIR_FILE..."

# Derive public key using Node.js + @solana/web3.js
PUBLIC_KEY=$(node -e "
  const { Keypair } = require('@solana/web3.js');
  const fs = require('fs');
  const bytes = JSON.parse(fs.readFileSync('$KEYPAIR_FILE', 'utf8'));
  const kp = Keypair.fromSecretKey(Uint8Array.from(bytes));
  console.log(kp.publicKey.toBase58());
")

echo "Wallet public key: $PUBLIC_KEY"

# Build the secret JSON
SECRET_KEY_ARRAY=$(cat "$KEYPAIR_FILE")
SECRET_JSON=$(node -e "
  const secretKey = $SECRET_KEY_ARRAY;
  console.log(JSON.stringify({
    public_key: '$PUBLIC_KEY',
    secret_key: secretKey
  }));
")

# Store in Secrets Manager (create or update)
echo "Storing wallet in Secrets Manager ($SECRET_ID)..."

if aws secretsmanager describe-secret --secret-id "$SECRET_ID" --region "$REGION" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value \
    --secret-id "$SECRET_ID" \
    --secret-string "$SECRET_JSON" \
    --region "$REGION"
  echo "Secret updated."
else
  aws secretsmanager create-secret \
    --name "$SECRET_ID" \
    --description "Solana devnet wallet keypair for paper trading agent" \
    --secret-string "$SECRET_JSON" \
    --region "$REGION"
  echo "Secret created."
fi

echo ""
echo "============================================"
echo "Wallet provisioned successfully!"
echo "Public key: $PUBLIC_KEY"
echo ""
echo "Next steps:"
echo "  1. Go to https://faucet.solana.com/"
echo "  2. Paste this public key: $PUBLIC_KEY"
echo "  3. Select 'devnet' and request SOL"
echo "  4. Verify at: https://explorer.solana.com/address/$PUBLIC_KEY?cluster=devnet"
echo "============================================"
