"""
SafeEscrow.algo — PyTeal Smart Contract
Reversible time-locked escrow with dispute resolution on Algorand AVM
"""

from pyteal import *


def approval_program():
    """
    Global State:
      sender        - escrow creator address
      recipient     - intended recipient
      amount        - locked amount (microALGO)
      asset_id      - 0=ALGO, else ASA ID (USDC mainnet=31566704)
      lock_until    - Unix timestamp; after this recipient can claim
      status        - 0=pending,1=claimed,2=cancelled,3=dispute
      dispute_yes   - votes for sender (refund)
      dispute_no    - votes for recipient (release)
      created_at    - creation timestamp
    """
    sender_key       = Bytes("sender")
    recipient_key    = Bytes("recipient")
    amount_key       = Bytes("amount")
    asset_id_key     = Bytes("asset_id")
    lock_until_key   = Bytes("lock_until")
    status_key       = Bytes("status")
    dispute_yes_key  = Bytes("dispute_yes")
    dispute_no_key   = Bytes("dispute_no")
    created_at_key   = Bytes("created_at")

    STATUS_PENDING   = Int(0)
    STATUS_CLAIMED   = Int(1)
    STATUS_CANCELLED = Int(2)
    STATUS_DISPUTE   = Int(3)

    ESCROW_FEE       = Int(1_000)
    DISPUTE_FEE      = Int(500_000)
    MIN_BALANCE      = Int(100_000)
    MIN_STAKE        = Int(5_000_000)
    VOTE_WINDOW      = Int(72 * 3600)

    is_sender    = Txn.sender() == App.globalGet(sender_key)
    is_recipient = Txn.sender() == App.globalGet(recipient_key)
    is_pending   = App.globalGet(status_key) == STATUS_PENDING
    is_disputed  = App.globalGet(status_key) == STATUS_DISPUTE
    lock_expired = Global.latest_timestamp() >= App.globalGet(lock_until_key)

    # CREATE
    on_create = Seq([
        Assert(Txn.application_args.length() == Int(3)),
        Assert(Txn.accounts.length() == Int(1)),
        App.globalPut(sender_key,      Txn.sender()),
        App.globalPut(recipient_key,   Txn.accounts[1]),
        App.globalPut(lock_until_key,  Global.latest_timestamp() + Btoi(Txn.application_args[1])),
        App.globalPut(asset_id_key,    Btoi(Txn.application_args[2])),
        App.globalPut(status_key,      STATUS_PENDING),
        App.globalPut(dispute_yes_key, Int(0)),
        App.globalPut(dispute_no_key,  Int(0)),
        App.globalPut(created_at_key,  Global.latest_timestamp()),
        App.globalPut(amount_key,      Int(0)),
        Int(1)
    ])

    # FUND
    on_fund = Seq([
        Assert(is_pending),
        Assert(is_sender),
        Assert(App.globalGet(amount_key) == Int(0)),
        Assert(Gtxn[0].type_enum() == TxnType.Payment),
        Assert(Gtxn[0].receiver() == Global.current_application_address()),
        Assert(Gtxn[0].amount() >= MIN_BALANCE + ESCROW_FEE),
        App.globalPut(amount_key, Gtxn[0].amount() - ESCROW_FEE - MIN_BALANCE),
        Int(1)
    ])

    # CANCEL (within lock window)
    on_cancel = Seq([
        Assert(is_pending),
        Assert(is_sender),
        Assert(Not(lock_expired)),
        App.globalPut(status_key, STATUS_CANCELLED),
        InnerTxnBuilder.Execute({
            TxnField.type_enum: TxnType.Payment,
            TxnField.receiver:  App.globalGet(sender_key),
            TxnField.amount:    App.globalGet(amount_key),
            TxnField.fee:       Int(0),
        }),
        Int(1)
    ])

    # CLAIM (after lock expires)
    on_claim = Seq([
        Assert(is_pending),
        Assert(is_recipient),
        Assert(lock_expired),
        App.globalPut(status_key, STATUS_CLAIMED),
        InnerTxnBuilder.Execute({
            TxnField.type_enum: TxnType.Payment,
            TxnField.receiver:  App.globalGet(recipient_key),
            TxnField.amount:    App.globalGet(amount_key),
            TxnField.fee:       Int(0),
        }),
        Int(1)
    ])

    # DISPUTE
    on_dispute = Seq([
        Assert(is_pending),
        Assert(Or(is_sender, is_recipient)),
        Assert(Gtxn[0].type_enum() == TxnType.Payment),
        Assert(Gtxn[0].receiver() == Global.current_application_address()),
        Assert(Gtxn[0].amount() >= DISPUTE_FEE),
        App.globalPut(status_key, STATUS_DISPUTE),
        Int(1)
    ])

    # VOTE
    juror_voted = Bytes("voted")
    juror_stake = Bytes("stake")

    on_vote = Seq([
        Assert(is_disputed),
        Assert(App.optedIn(Txn.sender(), Global.current_application_id())),
        Assert(App.localGet(Txn.sender(), juror_voted) == Int(0)),
        Assert(Gtxn[0].type_enum() == TxnType.Payment),
        Assert(Gtxn[0].amount() >= MIN_STAKE),
        App.localPut(Txn.sender(), juror_voted, Int(1)),
        App.localPut(Txn.sender(), juror_stake, Gtxn[0].amount()),
        If(
            Txn.application_args[1] == Bytes("sender"),
            App.globalPut(dispute_yes_key, App.globalGet(dispute_yes_key) + Int(1)),
            App.globalPut(dispute_no_key,  App.globalGet(dispute_no_key)  + Int(1)),
        ),
        Int(1)
    ])

    # RESOLVE
    vote_deadline = App.globalGet(created_at_key) + VOTE_WINDOW

    on_resolve = Seq([
        Assert(is_disputed),
        Assert(Global.latest_timestamp() >= vote_deadline),
        If(
            App.globalGet(dispute_yes_key) >= App.globalGet(dispute_no_key),
            Seq([
                App.globalPut(status_key, STATUS_CANCELLED),
                InnerTxnBuilder.Execute({
                    TxnField.type_enum: TxnType.Payment,
                    TxnField.receiver:  App.globalGet(sender_key),
                    TxnField.amount:    App.globalGet(amount_key),
                    TxnField.fee:       Int(0),
                }),
            ]),
            Seq([
                App.globalPut(status_key, STATUS_CLAIMED),
                InnerTxnBuilder.Execute({
                    TxnField.type_enum: TxnType.Payment,
                    TxnField.receiver:  App.globalGet(recipient_key),
                    TxnField.amount:    App.globalGet(amount_key),
                    TxnField.fee:       Int(0),
                }),
            ]),
        ),
        Int(1)
    ])

    action = Txn.application_args[0]

    return Cond(
        [Txn.application_id() == Int(0),  on_create],
        [action == Bytes("fund"),         on_fund],
        [action == Bytes("cancel"),       on_cancel],
        [action == Bytes("claim"),        on_claim],
        [action == Bytes("dispute"),      on_dispute],
        [action == Bytes("vote"),         on_vote],
        [action == Bytes("resolve"),      on_resolve],
    )


def clear_state_program():
    return Int(1)


if __name__ == "__main__":
    with open("escrow_approval.teal", "w") as f:
        f.write(compileTeal(approval_program(), mode=Mode.Application, version=8))
        print("escrow_approval.teal written")
    with open("escrow_clear.teal", "w") as f:
        f.write(compileTeal(clear_state_program(), mode=Mode.Application, version=8))
        print("escrow_clear.teal written")
