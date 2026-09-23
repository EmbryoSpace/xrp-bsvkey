(function(){
  var $=function(id){return document.getElementById(id)};
  var LS='bsvkey_xrp_wallet';
  var state={net:'mainnet', wallet:null, seedShown:false, backedUp:false, acct:null, sendMax:false};
  var WSS={testnet:'wss://s.altnet.rippletest.net:51233', mainnet:'wss://xrplcluster.com'};

  function showErr(m){var e=$('err');e.textContent=m;e.hidden=!m}
  function setNet(n){
    state.net=n;
    Array.prototype.forEach.call($('netSeg').children,function(b){b.classList.toggle('on',b.dataset.net===n)});
    $('netNote').textContent = n==='testnet' ? 'Testnet: free XRP from the faucet, safe for testing.' : 'Mainnet: real XRP. Double-check before funding.';
    $('faucetBtn').hidden = n!=='testnet';
    $('balOut').textContent=''; state.acct=null; showAvail();
    if(state.wallet) checkBalance();
  }

  function render(w){
    state.wallet=w; state.seedShown=false; state.backedUp=false;
    $('walletCard').hidden=false;
    $('seed').textContent='•••••••••••••••••••••••••••';
    $('addr').textContent=w.classicAddress;
    $('pub').textContent=w.publicKey;
    $('showSeed').textContent='Show';
    $('qr').innerHTML='';
    try{ new QRCode($('qr'),{text:w.classicAddress,width:150,height:150,colorDark:'#000',colorLight:'#fff'}); }catch(e){}
    $('faucetBtn').hidden = state.net!=='testnet';
    $('balOut').textContent='';
    state.acct=null; state.sendMax=false; showAvail();
    $('sendTo').value=''; $('sendAmt').value=''; $('sendTag').value=''; $('sendMemo').value=''; status('');
    checkBalance();
  }

  // Drops are integers (1 XRP = 1,000,000 drops); do the reserve math in drops.
  function xrpStr(drops){ return xrpl.dropsToXrp(String(Math.max(0, drops))); }

  // Balance, the reserve the ledger locks (base + per owned object), and what can
  // actually be sent. Returns null if the account is not activated yet.
  async function accountState(c, addr){
    var info;
    try{ info=(await c.request({command:'account_info', account:addr, ledger_index:'validated'})).result; }
    catch(e){ if(/actNotFound|Account not found/i.test(String(e && (e.data && e.data.error) || e.message))) return null; throw e; }
    var srv=(await c.request({command:'server_info'})).result.info.validated_ledger;
    var bal=Number(info.account_data.Balance);
    var owners=Number(info.account_data.OwnerCount||0);
    var reserve=Math.round((Number(srv.reserve_base_xrp)+owners*Number(srv.reserve_inc_xrp))*1e6);
    var fee=Math.max(12, Math.round(Number(srv.base_fee_xrp||0.00001)*1e6*1.2));
    return { balance:bal, reserve:reserve, fee:fee, spendable:Math.max(0, bal-reserve-fee), reserveBase:Math.round(Number(srv.reserve_base_xrp)*1e6) };
  }

  function showAvail(){
    var a=state.acct, el=$('sendAvail');
    if(!el) return;
    if(!a){ el.textContent=''; return; }
    el.textContent='Available to send: '+xrpStr(a.spendable)+' XRP  (balance '+xrpStr(a.balance)+' XRP, '+xrpStr(a.reserve)+' XRP reserve stays locked, network fee about '+xrpStr(a.fee)+' XRP)';
  }

  // The send status box: 'busy' (blue, spinner), 'ok' (green), 'bad' (red), or
  // 'info' (neutral). While busy, Send and Max are locked so one click can't
  // turn into two payments.
  function esc(t){ return String(t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]}); }
  function status(kind, text, smallHtml){
    var el=$('sendOut');
    if(!text){ el.hidden=true; el.className='status'; el.innerHTML=''; return; }
    el.hidden=false; el.className='status '+kind;
    el.innerHTML=(kind==='busy'?'<span class="spin" aria-hidden="true"></span>':'')+esc(text)+(smallHtml?'<span class="small">'+smallHtml+'</span>':'');
    var busy=(kind==='busy');
    $('sendBtn').disabled=busy; $('maxBtn').disabled=busy;
  }

  // Plain-English reasons for the ledger's result codes.
  var TX_REASONS={
    tecUNFUNDED_PAYMENT:'not enough spendable XRP. The ledger keeps the reserve locked, so you can send at most the "available to send" amount.',
    tecNO_DST_INSUF_XRP:'the destination is not activated yet, and a first payment to it must be at least the base reserve.',
    tecDST_TAG_NEED:'the destination requires a destination tag (exchanges usually do). Add the tag they gave you.',
    tecNO_DST:'the destination account does not exist.',
    temBAD_AMOUNT:'the amount is not valid.',
    temREDUNDANT:'you cannot send to your own address.',
    tefPAST_SEQ:'the transaction was already used. Check balance and try again.',
    telINSUF_FEE_P:'the network is busy and the fee was too low. Try again in a moment.'
  };
  // Read what people actually type: ".6", "0.6", "$0.6", "0,6", " 1 000.5 ".
  // Returns a canonical XRP string ("0.6"), or null if it is not a valid amount.
  // XRP has 6 decimal places (drops), so more than 6 decimals is refused.
  function normalizeAmount(raw){
    var s=String(raw||'').trim().replace(/^\$/,'').replace(/\s+/g,'').replace(/XRP$/i,'');
    // One comma is a decimal point ("0,6", "2,5") unless it reads as a thousands
    // separator ("1,000"); any other commas are thousands separators ("1,000,000").
    var cm=/^(\d*),(\d+)$/.exec(s);
    if(cm && (cm[1]===''||cm[1]==='0'||cm[2].length!==3)) s=cm[1]+'.'+cm[2];
    else s=s.replace(/,/g,'');
    if(/^\./.test(s)) s='0'+s;                        // ".6" -> "0.6"
    if(/\.$/.test(s)) s=s.slice(0,-1);                // "1." -> "1"
    if(!/^\d+(\.\d{1,6})?$/.test(s)) return null;
    s=s.replace(/^0+(?=\d)/,'');                     // "007" -> "7"
    return s;
  }

  function reasonFor(code){ return TX_REASONS[code] ? (code+': '+TX_REASONS[code]) : code; }

  // Read the on-chain balance for the current wallet on the current network.
  async function checkBalance(){
    if(!state.wallet) return;
    var target=state.wallet.classicAddress;
    $('balOut').textContent='checking balance...';
    var c=new xrpl.Client(WSS[state.net]);
    try{
      await c.connect();
      var a=await accountState(c, target);
      if(!(state.wallet && state.wallet.classicAddress===target)) return;
      state.acct=a; showAvail();
      if(a) $('balOut').innerHTML='<span class="pill good">'+xrpStr(a.balance)+' XRP</span> <span class="muted">'+xrpStr(a.spendable)+' spendable</span>';
      else $('balOut').innerHTML='<span class="pill bad">not activated</span> <span class="muted">fund it with at least the base reserve</span>';
    }catch(e){
      if(state.wallet && state.wallet.classicAddress===target)
        $('balOut').textContent='could not reach the network: '+e.message;
    }
    finally{ try{await c.disconnect()}catch(e){} }
  }

  $('createBtn').onclick=function(){
    showErr('');
    try{ var w=xrpl.Wallet.generate(); render(w); if($('saveChk').checked) save(); }
    catch(e){ showErr('Could not create a wallet: '+e.message); }
  };
  $('importBtn').onclick=function(){ $('importRow').hidden=!$('importRow').hidden; };
  $('revealIn').onclick=function(){
    var i=$('seedIn'); i.type = i.type==='password' ? 'text' : 'password';
    $('revealIn').textContent = i.type==='password' ? 'Show' : 'Hide';
  };

  // Load a seed string, render the wallet, and wipe every trace of the seed
  // from the import UI so it only lives in the one masked Seed area.
  function loadSeed(s){
    showErr('');
    s=(s||'').trim();
    if(!s){ showErr('No seed found to import.'); return false; }
    try{
      var w=xrpl.Wallet.fromSeed(s);
      render(w);
      if($('saveChk').checked) save();
      // clear and hide the import inputs; seed is now only in the masked area
      $('seedIn').value=''; $('seedIn').type='password'; $('revealIn').textContent='Show';
      $('fileIn').value='';
      $('importRow').hidden=true;
      return true;
    }catch(e){ showErr('That is not a valid family seed: '+e.message); return false; }
  }

  // Pull a family seed out of an exported .json or .txt backup.
  function extractSeed(text){
    text=String(text||'');
    // JSON backup: {"seed":"s..."}
    try{ var o=JSON.parse(text); if(o&&typeof o.seed==='string') return o.seed.trim(); }catch(e){}
    // txt backup or any text: find the first XRPL family seed token
    var m=text.match(/\bs[1-9A-HJ-NP-Za-km-z]{25,}\b/);
    return m ? m[0] : '';
  }

  $('loadBtn').onclick=function(){ loadSeed($('seedIn').value); };
  $('fileIn').onchange=function(){
    var f=this.files&&this.files[0]; if(!f) return;
    var rd=new FileReader();
    rd.onload=function(){
      var s=extractSeed(rd.result);
      if(!s){ showErr('Could not find a seed in that file. Use a .json or .txt exported by this tool.'); $('fileIn').value=''; return; }
      loadSeed(s);
    };
    rd.onerror=function(){ showErr('Could not read that file.'); };
    rd.readAsText(f);
  };
  $('showSeed').onclick=function(){
    if(!state.wallet)return;
    state.seedShown=!state.seedShown;
    $('seed').textContent = state.seedShown ? state.wallet.seed : '•••••••••••••••••••••••••••';
    $('showSeed').textContent = state.seedShown ? 'Hide' : 'Show';
  };
  function copy(text,btn){navigator.clipboard.writeText(text).then(function(){var t=btn.textContent;btn.textContent='Copied';setTimeout(function(){btn.textContent=t},1200)})}
  $('copySeed').onclick=function(){ if(state.wallet){ copy(state.wallet.seed,$('copySeed')); state.backedUp=true; } };
  $('copyAddr').onclick=function(){ if(state.wallet) copy(state.wallet.classicAddress,$('copyAddr')); };

  function download(filename,text,mime){
    var blob=new Blob([text],{type:mime||'text/plain'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');
    a.href=url; a.download=filename;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); },100);
  }
  $('dlJson').onclick=function(){
    if(!state.wallet)return;
    var w=state.wallet;
    var data={
      type:'xrp-wallet-backup', version:1, network:state.net,
      classicAddress:w.classicAddress, publicKey:w.publicKey, seed:w.seed,
      createdAt:new Date().toISOString(), createdBy:'xrp.bsvkey.com',
      warning:'This file contains the SECRET SEED in plain text. Anyone with it controls the funds. Keep it offline and private.'
    };
    download('xrp-wallet-'+w.classicAddress.slice(0,8)+'.json', JSON.stringify(data,null,2), 'application/json');
    state.backedUp=true;
  };
  $('dlTxt').onclick=function(){
    if(!state.wallet)return;
    var w=state.wallet;
    var t=[
      'XRP WALLET PAPER BACKUP',
      '=======================',
      'Created: '+new Date().toISOString(),
      'Network: '+state.net,
      '',
      'Classic address (share to receive / fund):',
      '  '+w.classicAddress,
      '',
      'Public key:',
      '  '+w.publicKey,
      '',
      'SECRET SEED (keep private, controls all funds):',
      '  '+w.seed,
      '',
      'WARNING: Anyone who has the seed above can spend this wallet.',
      'Store this paper offline. Do not photograph or email it.',
      'Tool: xrp.bsvkey.com'
    ].join('\n');
    download('xrp-wallet-'+w.classicAddress.slice(0,8)+'.txt', t, 'text/plain');
    state.backedUp=true;
  };

  $('balBtn').onclick=function(){ checkBalance(); };

  // Max: everything above the locked reserve, less the network fee. The exact fee
  // is re-applied at send time so a max send never fails on a fee change.
  $('maxBtn').onclick=async function(){
    if(!state.wallet){ status('info','Create or import a wallet first.'); return; }
    status('busy','Reading your balance...');
    var c=new xrpl.Client(WSS[state.net]);
    try{
      await c.connect();
      var a=await accountState(c, state.wallet.classicAddress);
      state.acct=a; showAvail();
      if(!a || a.spendable<=0){ $('sendAmt').value=''; state.sendMax=false; status('info','Nothing to send above the locked reserve.'); return; }
      $('sendAmt').value=xrpStr(a.spendable); state.sendMax=true; status('');
    }catch(e){ status('bad','Could not reach the XRP Ledger: '+e.message); }
    finally{ try{await c.disconnect()}catch(e){} }
  };
  $('sendAmt').addEventListener('input', function(){ state.sendMax=false; });
  $('sendAmt').addEventListener('blur', function(){ var n=normalizeAmount(this.value); if(n!==null && n!==this.value) this.value=n; });

  // Send XRP. Checks the address, the spendable amount, and the destination's
  // requirements first, then asks ONE confirmation that always spells out the
  // memo (so a missing memo is never a surprise), then signs and submits.
  $('sendBtn').onclick=async function(){
    if(!state.wallet){ status('info','Create or import a wallet first.'); return; }
    var to=$('sendTo').value.trim();
    var amt=$('sendAmt').value.trim();
    var tag=$('sendTag').value.trim();
    var memo=$('sendMemo').value.trim();
    var say=function(t){ status('bad', t.charAt(0).toUpperCase()+t.slice(1)); };

    if(!to){ say('enter a destination address'); $('sendTo').focus(); return; }
    if(!xrpl.isValidClassicAddress(to)){ say('that is not a valid XRP address (it should start with r)'); $('sendTo').focus(); return; }
    if(to===state.wallet.classicAddress){ say('that is this wallet\'s own address'); return; }
    if(!amt){ say('enter an amount in XRP'); $('sendAmt').focus(); return; }
    var norm=normalizeAmount(amt);
    if(norm===null){ say('that amount is not valid: use digits and at most 6 decimals, for example 0.6'); $('sendAmt').focus(); return; }
    if(!(Number(norm)>0)){ say('enter an amount above 0'); $('sendAmt').focus(); return; }
    if(norm!==amt){ $('sendAmt').value=norm; amt=norm; }   // show what will actually be sent
    if(tag!=='' && !/^\d+$/.test(tag)){ say('the destination tag must be a whole number'); $('sendTag').focus(); return; }

    var c=new xrpl.Client(WSS[state.net]);
    try{
      status('busy','Checking your balance and the destination...');
      await c.connect();
      var a=await accountState(c, state.wallet.classicAddress);
      state.acct=a; showAvail();
      if(!a){ say('this wallet is not activated yet: fund it with at least the base reserve first'); return; }
      var drops=Number(xrpl.xrpToDrops(amt));   // exact, string-based: no float rounding
      if(!state.sendMax && drops>a.spendable){ say('you can send at most '+xrpStr(a.spendable)+' XRP. '+xrpStr(a.reserve)+' XRP stays locked as the ledger reserve. Use Max to send everything available.'); return; }

      var dest=await accountState(c, to).catch(function(){ return undefined; });
      if(dest===null && drops<a.reserveBase){ say('the destination is not activated yet, so the first payment to it must be at least '+xrpStr(a.reserveBase)+' XRP'); return; }
      if(dest!==undefined && dest!==null && tag===''){
        try{
          var di=(await c.request({command:'account_info', account:to, ledger_index:'validated'})).result.account_data;
          if((Number(di.Flags)&0x00020000)!==0){ say('this destination requires a destination tag (exchanges usually give you one). Add it and press Send again.'); $('sendTag').focus(); return; }
        }catch(e){}
      }

      var netLabel = state.net==='mainnet' ? 'MAINNET (real XRP)' : 'testnet';
      var confirmMsg='Send '+(state.sendMax?'the maximum (about '+xrpStr(a.spendable)+')':amt)+' XRP on '+netLabel+'\nto '+to
        +(tag?('\ndestination tag: '+tag):'\ndestination tag: none')
        +(memo?('\nmemo (public, on-chain): "'+memo+'"'):'\nmemo: none. To add one, click Cancel, fill in the Memo box, and press Send again.')
        +'\n\nThis is irreversible. Send now?';
      if(!window.confirm(confirmMsg)) { status('info','Cancelled. Nothing was sent.'); return; }

      status('busy','Sending... signing and submitting to the XRP Ledger. Keep this page open.', 'This usually takes 3 to 5 seconds.');
      var tx={ TransactionType:'Payment', Account:state.wallet.classicAddress, Destination:to, Amount:String(drops) };
      if(tag!==''){ tx.DestinationTag=Number(tag); }
      if(memo){ tx.Memos=[{ Memo:{ MemoData: xrpl.convertStringToHex(memo) } }]; }
      var prepared=await c.autofill(tx);
      if(state.sendMax){
        // Re-apply the exact fee the network asked for, so "max" never overdraws.
        var maxDrops=a.balance-a.reserve-Number(prepared.Fee);
        if(maxDrops<=0){ say('nothing to send above the reserve and fee'); return; }
        prepared.Amount=String(maxDrops);
      }
      var signed=state.wallet.sign(prepared);
      var res=await c.submitAndWait(signed.tx_blob);
      var code=res.result && res.result.meta && res.result.meta.TransactionResult;
      if(code==='tesSUCCESS'){
        var hash=res.result.hash;
        status('ok','Sent '+xrpStr(Number(res.result.meta.delivered_amount||prepared.Amount))+' XRP. Confirmed on the ledger.',
          'tx '+esc(hash)+' &middot; <a href="'+(state.net==='mainnet'?'https://livenet.xrpl.org/transactions/':'https://testnet.xrpl.org/transactions/')+hash+'" target="_blank" rel="noopener noreferrer">view on the XRPL explorer</a>');
        state.sendMax=false; $('sendAmt').value='';
        checkBalance();
      } else {
        status('bad','Not sent: '+reasonFor(code||'failed'));
      }
    }catch(e){
      var m=String((e && e.data && (e.data.engine_result||e.data.error)) || e.message || e);
      status('bad','Not sent: '+reasonFor(m));
    }
    finally{ try{await c.disconnect()}catch(e){} $('sendBtn').disabled=false; $('maxBtn').disabled=false; }
  };

  $('faucetBtn').onclick=async function(){
    if(!state.wallet||state.net!=='testnet')return;
    $('balOut').textContent='requesting testnet XRP...';
    var c=new xrpl.Client(WSS.testnet);
    try{ await c.connect(); var r=await c.fundWallet(state.wallet); $('balOut').innerHTML='<span class="pill good">funded: '+r.balance+' XRP</span>'; }
    catch(e){ $('balOut').textContent='faucet failed: '+e.message; }
    finally{ try{await c.disconnect()}catch(e){} }
  };

  function save(){ try{ localStorage.setItem(LS, JSON.stringify({net:state.net, seed:state.wallet.seed})); $('forgetBtn').hidden=false; state.backedUp=true; }catch(e){} }
  function forget(){ try{ localStorage.removeItem(LS); }catch(e){} $('forgetBtn').hidden=true; $('saveChk').checked=false; }
  $('saveChk').onchange=function(){ if(this.checked && state.wallet){ save(); } else { forget(); } };
  $('forgetBtn').onclick=forget;

  // Forget wallet: wipe it from the page and this browser, with a guard if not backed up.
  $('wipeBtn').onclick=function(){
    if(!state.wallet)return;
    var msg = state.backedUp
      ? 'Forget this wallet? It will be cleared from this page and this browser.'
      : 'You have NOT downloaded or copied the seed. If you forget this wallet now, any funds in it are lost forever. Forget it anyway?';
    if(!window.confirm(msg)) return;
    forget();
    state.wallet=null; state.seedShown=false; state.backedUp=false;
    $('walletCard').hidden=true;
    $('seed').textContent=''; $('addr').textContent=''; $('pub').textContent='';
    $('qr').innerHTML=''; $('balOut').textContent='';
  };

  // Reminder on leave if a wallet exists that hasn't been backed up.
  window.addEventListener('beforeunload',function(e){
    if(state.wallet && !state.backedUp){ e.preventDefault(); e.returnValue=''; return ''; }
  });

  $('netSeg').addEventListener('click',function(e){ if(e.target.dataset&&e.target.dataset.net) setNet(e.target.dataset.net); });

  // auto-restore a saved wallet (and check its balance on load)
  try{
    var saved=JSON.parse(localStorage.getItem(LS)||'null');
    if(saved&&saved.seed){ setNet(saved.net||'mainnet'); $('saveChk').checked=true; render(xrpl.Wallet.fromSeed(saved.seed)); $('forgetBtn').hidden=false; state.backedUp=true; }
    else setNet('mainnet');
  }catch(e){ setNet('mainnet'); }
})();
