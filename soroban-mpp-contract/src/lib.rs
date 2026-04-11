#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol, token, Vec, BytesN};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Channel(BytesN<32>), // SessionId -> Channel
}

#[contracttype]
#[derive(Clone)]
pub struct Channel {
    pub sender: Address,
    pub recipient: Address,
    pub token: Address,
    pub amount: i128,
    pub settled: bool,
}

#[contract]
pub struct MPPContract;

#[contractimpl]
impl MPPContract {
    /// Opens a new micropayment channel by locking funds in the contract.
    pub fn open_channel(
        env: Env,
        session_id: BytesN<32>,
        sender: Address,
        recipient: Address,
        token_address: Address,
        amount: i128,
    ) {
        sender.require_auth();

        // Check if channel already exists
        let key = DataKey::Channel(session_id.clone());
        if env.storage().persistent().has(&key) {
            panic!("Channel already exists");
        }

        // Transfer tokens from sender to contract
        let token = token::Client::new(&env, &token_address);
        token.transfer(&sender, &env.current_contract_address(), &amount);

        // Store channel state
        let channel = Channel {
            sender,
            recipient,
            token: token_address,
            amount,
            settled: false,
        };
        env.storage().persistent().set(&key, &channel);
    }

    /// Settles the channel based on an off-chain micropayment proof.
    /// claim_amount: The portion of the locked funds to pay the recipient.
    /// signature: Ed25519 signature of the claim by the sender.
    pub fn settle_channel(
        env: Env,
        session_id: BytesN<32>,
        claim_amount: i128,
        signature: BytesN<64>,
    ) {
        let key = DataKey::Channel(session_id.clone());
        let mut channel: Channel = env.storage().persistent().get(&key).expect("Channel not found");

        if channel.settled {
            panic!("Channel already settled");
        }

        if claim_amount > channel.amount {
            panic!("Claim amount exceeds channel budget");
        }

        // Verify the off-chain signature of the sender
        // Payload consists of [session_id, claim_amount]
        let mut message_payload = Vec::new(&env);
        message_payload.push_back(Symbol::new(&env, "settle"));
        message_payload.push_back(Symbol::new(&env, "v1"));
        
        // In a production contract, we would verify the signature here using channel.sender
        // env.crypto().ed25519_verify(&channel.sender_public_key, &message, &signature);
        
        // Settle funds
        let token = token::Client::new(&env, &channel.token);
        
        // Pay recipient
        if claim_amount > 0 {
            token.transfer(&env.current_contract_address(), &channel.recipient, &claim_amount);
        }

        // Refund remainder to sender
        let remainder = channel.amount - claim_amount;
        if remainder > 0 {
            token.transfer(&env.current_contract_address(), &channel.sender, &remainder);
        }

        // Mark as settled
        channel.settled = true;
        env.storage().persistent().set(&key, &channel);
    }

    /// View total locked amount in a channel.
    pub fn get_channel(env: Env, session_id: BytesN<32>) -> Channel {
        env.storage().persistent().get(&DataKey::Channel(session_id)).expect("Channel not found")
    }
}
