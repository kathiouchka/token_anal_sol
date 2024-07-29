// Import necessary libraries
const { PublicKey, Connection, clusterApiUrl } = require('@solana/web3.js');
const EventEmitter = require('eventemitter3');
const fs = require('fs');

// Constants
const JUP_PROGRAM_ID = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
const connection = new Connection(clusterApiUrl('mainnet-beta'));
const emitter = new EventEmitter();
const logFilePath = 'transactions.log';

// Global bucket for total SOL traded
let totalSolTraded = 0;

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
async function monitorTransactions(mintAddress) {
    const startMessage = `Starting to monitor transactions for mint address: ${mintAddress.toBase58()}`;
    console.log(startMessage);
    logToFile(startMessage);

    connection.onLogs(mintAddress, (logs, context) => {
        const logsMessage = `Received logs: ${JSON.stringify(logs)}`;
        console.log("RECEIVED EVENT");

        // Skip events with errors
        if (logs.err) {
            const errorMessage = `Skipping event with error: ${JSON.stringify(logs.err)}`;
            console.log(errorMessage);
            return;
        }
        logToFile(logsMessage);

        logs.logs.forEach(log => {
            if (log.includes('Instruction: Swap') && logs.logs.some(l => l.includes(JUP_PROGRAM_ID.toBase58()))) {
                const swapDetectedMessage = `Jupiter swap instruction detected in log: ${log}`;
                console.log(swapDetectedMessage);
                logToFile(swapDetectedMessage);

                connection.getTransaction(logs.signature, { maxSupportedTransactionVersion: 0 }).then(transaction => {
                    if (transaction) {
                        const transactionFetchedMessage = `Transaction fetched: ${JSON.stringify(transaction)}`;
                        console.log(transactionFetchedMessage);
                        logToFile(transactionFetchedMessage);

                        emitter.emit('transaction', transaction);
                    }
                }).catch(err => {
                    const errorMessage = `Error fetching transaction: ${err}`;
                    console.error(errorMessage);
                    logToFile(errorMessage);
                });
            }
        });
    });
}

// Function to extract SOL amount from transaction
function getSolAmountFromTransaction(meta) {
    const preBalance = meta.preBalances[0] / 1e9;
    const postBalance = meta.postBalances[0] / 1e9;
    return preBalance - postBalance;
}

// Function to check if the amount is valid (round numbers with max one decimal place)
function isValidAmount(amount) {
    return amount % 1 === 0 || (amount * 10) % 1 === 0;
}

// Function to update the bucket and display it
function updateBucket(amount) {
    totalSolTraded += amount;
    displayBucket();
}

function displayBucket() {
    const bucketMessage = `Total SOL Traded: ${totalSolTraded}`;
    console.log(bucketMessage);
    logToFile(bucketMessage);
}

// Event listener for transactions
emitter.on('transaction', (transaction) => {
    const { transaction: { message }, meta } = transaction;
    const transactionProcessingMessage = `Processing transaction: ${transaction.transaction.signatures[0]}`;
    console.log(transactionProcessingMessage);
    logToFile(transactionProcessingMessage);

    const transactionDataMessage = `Transaction data: ${JSON.stringify(transaction)}`;
    console.log(transactionDataMessage);
    logToFile(transactionDataMessage);

    if (message.instructions.some(instr => instr.programId.equals(JUP_PROGRAM_ID))) {
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
});

// Main function to start monitoring
(async () => {
    const mintAddress = getTokenMintAddress();
    await monitorTransactions(mintAddress);
    const monitoringMessage = `Monitoring transactions for token mint address: ${mintAddress.toBase58()}`;
    console.log(monitoringMessage);
    logToFile(monitoringMessage);
})();
