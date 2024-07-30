// Import necessary libraries
const { PublicKey, Connection, clusterApiUrl } = require('@solana/web3.js');
const EventEmitter = require('eventemitter3');
const fs = require('fs');
const Bottleneck = require('bottleneck');

require('dotenv').config();

// Constants
const JUP_PROGRAM_ID = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${process.env.API_KEY}`);
const emitter = new EventEmitter();
const logFilePath = 'transactions.log';

// Global bucket for total SOL traded
let totalSolTraded = 0;

const ipLimiter = new Bottleneck({
    maxConcurrent: 40,
    minTime: 100, // 100ms between requests (10 requests per second)
});

const rpcLimiter = new Bottleneck({
    maxConcurrent: 10,
    minTime: 100, // 500ms between requests (2 requests per second)
});

const dataLimiter = new Bottleneck({
    reservoir: 100 * 1024 * 1024, // 100 MB
    reservoirRefreshAmount: 100 * 1024 * 1024,
    reservoirRefreshInterval: 30 * 1000, // 30 seconds
});

// Function to log messages to a file
function logToFile(message) {
    fs.appendFileSync(logFilePath, `${new Date().toISOString()} - ${message}\n`, 'utf8');
}

// Function to get token mint address from command line arguments
function getTokenMintAddress() {
    if (process.argv.length < 3) {
        const errorMessage = "Usage: node index.js <token_mint_address>";
        console.error(errorMessage);
        logToFile(errorMessage);
        process.exit(1);
    }
    return new PublicKey(process.argv[2]);
}

// Function to monitor transactions for a specific mint address
const transactionQueue = new Bottleneck({
    maxConcurrent: 1, // Process one transaction at a time
    minTime: 1000 // Wait at least 1 second between processing transactions
});

async function monitorTransactions(mintAddress) {
    const startMessage = `Starting to monitor transactions for mint address: ${mintAddress.toBase58()}`;
    console.log(startMessage);
    logToFile(startMessage);

    connection.onLogs(mintAddress, (logs, context) => {
        processLogs(logs);
    });
}

function processLogs(logs) {
    console.log("RECEIVED EVENT");

    // Skip events with errors
    if (logs.err) {
        console.log(`Skipping event with error: ${JSON.stringify(logs.err)}`);
        return;
    }
    logToFile(`Received logs: ${JSON.stringify(logs)}`);

    let isJupiterSwap = false;
    let hasRouteInstruction = false;
    let hasTransferInstructions = false;

    logs.logs.forEach(log => {
        if (log.includes(JUP_PROGRAM_ID.toBase58())) {
            isJupiterSwap = true;
        }
        if (log.includes('Instruction: Route')) {
            hasRouteInstruction = true;
        }
        if (log.includes('Instruction: Transfer')) {
            hasTransferInstructions = true;
        }
    });

    if (isJupiterSwap && hasRouteInstruction && hasTransferInstructions) {
        console.log(`Jupiter swap detected in transaction: ${logs.signature}`);
        logToFile(`Jupiter swap detected in transaction: ${logs.signature}`);

        rpcLimiter.schedule(() => 
            connection.getTransaction(logs.signature, { maxSupportedTransactionVersion: 0 })
        ).then(transaction => {
            if (transaction) {
                console.log(`Transaction fetched: ${JSON.stringify(transaction)}`);
                logToFile(`Transaction fetched: ${JSON.stringify(transaction)}`);
                dataLimiter.schedule(() => emitter.emit('transaction', transaction));
            }
        }).catch(err => {
            console.error(`Error fetching transaction: ${err}`);
            logToFile(`Error fetching transaction: ${err}`);
        });
    }
}

// Function to extract SOL amount from transaction
function getSolAmountFromTransaction(meta) {
    const solMint = 'So11111111111111111111111111111111111111112';
    const preSolBalance = meta.preTokenBalances.find(balance => balance.mint === solMint);
    const postSolBalance = meta.postTokenBalances.find(balance => balance.mint === solMint);

    if (preSolBalance && postSolBalance) {
        const preAmount = parseFloat(preSolBalance.uiTokenAmount.uiAmountString);
        const postAmount = parseFloat(postSolBalance.uiTokenAmount.uiAmountString);
        return Math.abs(postAmount - preAmount);
    }

    return 0;
}

// Function to check if the amount is valid
function isValidAmount(amount) {
    return amount !== 0 && isFinite(amount);
}

// Function to update the bucket and display it
function updateBucket(amount) {
    totalSolTraded += Math.abs(amount);
    displayBucket();
}

function displayBucket() {
    const bucketMessage = `Total SOL Traded: ${totalSolTraded.toFixed(4)}`;
    console.log(bucketMessage);
    logToFile(bucketMessage);
}

// Event listener for transactions
emitter.on('transaction', (transaction) => {
    const transactionProcessingMessage = `Processing transaction: ${transaction.transaction.signatures[0]}`;
    console.log(transactionProcessingMessage);
    logToFile(transactionProcessingMessage);

    const transactionDataMessage = `Transaction data: ${JSON.stringify(transaction)}`;
    console.log(transactionDataMessage);
    logToFile(transactionDataMessage);

    // Check if transaction and meta exist
    if (transaction && transaction.meta) {
        const { meta, transaction: { message } } = transaction;

        // Check if instructions exist and is an array
        if (Array.isArray(message.compiledInstructions)) {
            const jupiterInstruction = message.compiledInstructions.find(instr =>
                message.staticAccountKeys[instr.programIdIndex].equals(JUP_PROGRAM_ID)
            );

            if (jupiterInstruction) {
                const jupiterInstructionMessage = 'Transaction contains Jupiter swap instruction.';
                console.log(jupiterInstructionMessage);
                logToFile(jupiterInstructionMessage);

                const solAmount = getSolAmountFromTransaction(meta);
                const solAmountDetectedMessage = `SOL amount detected: ${solAmount}`;
                console.log(solAmountDetectedMessage);
                logToFile(solAmountDetectedMessage);

                if (isValidAmount(solAmount)) {
                    const validSolAmountMessage = `Valid SOL amount: ${solAmount}`;
                    console.log(validSolAmountMessage);
                    logToFile(validSolAmountMessage);
                    updateBucket(solAmount);
                } else {
                    const invalidSolAmountMessage = `Invalid SOL amount: ${solAmount}`;
                    console.log(invalidSolAmountMessage);
                    logToFile(invalidSolAmountMessage);
                }
            } else {
                const noJupiterInstructionMessage = 'Transaction does not contain Jupiter swap instruction.';
                console.log(noJupiterInstructionMessage);
                logToFile(noJupiterInstructionMessage);
            }
        } else {
            console.log('Transaction instructions are missing or not an array');
            logToFile('Transaction instructions are missing or not an array');
        }
    } else {
        console.log('Transaction structure is not as expected');
        logToFile('Transaction structure is not as expected');
    }
});

// Main function to start monitoring
(async () => {
    const mintAddress = getTokenMintAddress();
    await monitorTransactions(mintAddress);
    const monitoringMessage = `Monitoring transactions for token mint address: ${mintAddress.toBase58()}`;
    console.log(monitoringMessage);
    logToFile(monitoringMessage);
})();