// Import necessary libraries
const { PublicKey, Connection, clusterApiUrl } = require('@solana/web3.js');
const EventEmitter = require('eventemitter3');
const fs = require('fs');
const Bottleneck = require('bottleneck');
const chalk = require('chalk');

require('dotenv').config();

// Constants
const JUP_PROGRAM_ID = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${process.env.API_KEY}`);
const emitter = new EventEmitter();
const logFilePath = 'transactions.log';
const processedSignatures = new Set();

// Global bucket for total SOL traded
let totalSolTraded = 0;

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


async function monitorTransactions(mintAddress) {
    const startMessage = `Starting to monitor transactions for mint address: ${mintAddress.toBase58()}`;
    console.log(startMessage);
    logToFile(startMessage);

    connection.onLogs(mintAddress, (logs, context) => {
        processLogs(logs);
    });
}

function processLogs(logs) {

    // Skip events with errors
    if (logs.err) {
        return;
    }

    // Check if the signature has already been processed
    if (processedSignatures.has(logs.signature)) {
        // console.log(chalk.yellow(`Skipping already processed signature: ${logs.signature}`));
        return;
    }

    processedSignatures.add(logs.signature);
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
        console.log(chalk.cyan(`Jupiter swap detected in transaction: ${logs.signature}`));
        logToFile(`Jupiter swap detected in transaction: ${logs.signature}`);

        rpcLimiter.schedule(() =>
            connection.getTransaction(logs.signature, { maxSupportedTransactionVersion: 0 })
        ).then(transaction => {
            if (transaction) {
                logToFile(`Transaction fetched: ${JSON.stringify(transaction)}`);
                dataLimiter.schedule(() => emitter.emit('transaction', transaction));
            }
        }).catch(err => {
            console.error(chalk.red(`Error fetching transaction: ${err}`));
            logToFile(`Error fetching transaction: ${err}`);
        });
    }
}

// Function to extract SOL amount from transaction
function getSolAmountFromTransactioniAndOwner(meta) {
    const solMint = 'So11111111111111111111111111111111111111112';
    const preSolBalance = meta.preTokenBalances.find(balance => balance.mint === solMint);
    const postSolBalance = meta.postTokenBalances.find(balance => balance.mint === solMint);

    if (preSolBalance && postSolBalance) {
        const preAmount = parseFloat(preSolBalance.uiTokenAmount.uiAmountString);
        const postAmount = parseFloat(postSolBalance.uiTokenAmount.uiAmountString);
        return Math.abs(postAmount - preAmount);
    }
    return 0
}

function isValidAmount(amount) {
    return amount !== 0 && isFinite(amount) && amount < 10;
}

// Function to update the bucket and display it
function updateBucket(amount) {
    totalSolTraded += Math.abs(amount);
    displayBucket();
}

function displayBucket() {
    const bucketMessage = `Total SOL Traded: ${totalSolTraded.toFixed(4)}`;
    console.log(chalk.green(bucketMessage));
    logToFile(bucketMessage);
}

// Event listener for transactions
emitter.on('transaction', (transaction) => {

    const transactionDataMessage = `Transaction data: ${JSON.stringify(transaction)}`;
    // console.log(chalk.blue(transactionDataMessage));
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

                const buyerAddress = message.staticAccountKeys[0];
                const solAmount = getSolAmountFromTransactioniAndOwner(meta);
                const solAmountDetectedMessage = `SOL amount detected: ${solAmount}`;
                console.log(chalk.cyan(solAmountDetectedMessage));
                logToFile(solAmountDetectedMessage);

                if (isValidAmount(solAmount)) {
                    const roundedAmount = Math.round(solAmount * 10) / 10;
                    if (Math.abs(solAmount - roundedAmount) < 0.00001) {
                        const humanTransactionMessage = `Human transaction detected: Address ${buyerAddress} bought ${solAmount.toFixed(1)} SOL`;

                        console.log(chalk.green(humanTransactionMessage));

                        logToFile(humanTransactionMessage);
                        updateBucket(solAmount);
                    }
                } else {
                    const invalidSolAmountMessage = `Invalid SOL amount: ${solAmount}`;
                    console.log(chalk.red(invalidSolAmountMessage));
                    logToFile(invalidSolAmountMessage);
                }
            } else {
                const noJupiterInstructionMessage = 'Transaction does not contain Jupiter swap instruction.';
                console.log(chalk.yellow(noJupiterInstructionMessage));
                logToFile(noJupiterInstructionMessage);
            }
        } else {
            console.log(chalk.red('Transaction instructions are missing or not an array'));
            logToFile('Transaction instructions are missing or not an array');
        }
    } else {
        console.log(chalk.red('Transaction structure is not as expected'));
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