(function(){
  var $=function(id){return document.getElementById(id)};
  var LS='bsvkey_xrp_wallet';
  var state={net:'mainnet', wallet:null, seedShown:false, backedUp:false};
  var WSS={testnet:'wss://s.altnet.rippletest.net:51233', mainnet:'wss://xrplcluster.com'};

  function showErr(m){var e=$('err');e.textContent=m;e.hidden=!m}
  function setNet(n){
    state.net=n;
    Array.prototype.forEach.call($('netSeg').children,function(b){b.classList.toggle('on',b.dataset.net===n)});
    $('netNote').textContent = n==='testnet' ? 'Testnet: free XRP from the faucet, safe for testing.' : 'Mainnet: real XRP. Double-check before funding.';
    $('faucetBtn').hidden = n!=='testnet';
    $('balOut').textContent='';
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
    $('sendTo').value=''; $('sendAmt').value=''; $('sendTag').value=''; $('sendMemo').value=''; $('sendOut').textContent='';
    checkBalance();
  }

  // Read the on-chain balance for the current wallet on the current network.
  async function checkBalance(){
    if(!state.wallet) return;
    var target=state.wallet.classicAddress;
    $('balOut').textContent='checking balance...';
    var c=new xrpl.Client(WSS[state.net]);
    try{
      await c.connect();
      try{
        var bal=await c.getXrpBalance(target);
        if(state.wallet && state.wallet.classicAddress===target)
          $('balOut').innerHTML='<span class="pill good">'+bal+' XRP</span>';
      }catch(inner){
        if(state.wallet && state.wallet.classicAddress===target)
          $('balOut').innerHTML='<span class="pill bad">not activated</span> <span class="muted">fund it with at least the base reserve</span>';
      }
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

  // Send XRP. Always asks about the memo after Send is clicked, then confirms
  // the (irreversible) transfer, then signs and submits from the browser.
  $('sendBtn').onclick=async function(){
    if(!state.wallet){ $('sendOut').textContent='create or import a wallet first'; return; }
    var to=$('sendTo').value.trim();
    var amt=$('sendAmt').value.trim();
    var tag=$('sendTag').value.trim();
    var memo=$('sendMemo').value;

    if(!to){ $('sendOut').textContent='enter a destination address'; $('sendTo').focus(); return; }
    if(!amt || Number(amt)<=0){ $('sendOut').textContent='enter an amount in XRP'; $('sendAmt').focus(); return; }

    // Always ask about the memo after Send is clicked.
    var wantMemo = window.confirm(
      (memo.trim()
        ? 'Your memo is:\n\n"'+memo.trim()+'"\n\nClick OK to edit it, or Cancel to send with this memo.'
        : 'Do you want to add anything to the memo box (an invoice ID, reference, or note)?\n\nClick OK to add a memo now, or Cancel to send without one.')
    );
    if(wantMemo){ $('sendMemo').focus(); $('sendOut').textContent='add your memo, then click Send again'; return; }

    memo=memo.trim();
    var netLabel = state.net==='mainnet' ? 'MAINNET (real XRP)' : 'testnet';
    var confirmMsg='Send '+amt+' XRP on '+netLabel+'\nto '+to
      +(tag?('\ndestination tag: '+tag):'')
      +(memo?('\nmemo: "'+memo+'"'):'\n(no memo)')
      +'\n\nThis is irreversible. Proceed?';
    if(!window.confirm(confirmMsg)) { $('sendOut').textContent='cancelled'; return; }

    $('sendOut').textContent='signing and submitting...';
    var c=new xrpl.Client(WSS[state.net]);
    try{
      await c.connect();
      var tx={ TransactionType:'Payment', Account:state.wallet.classicAddress, Destination:to, Amount:xrpl.xrpToDrops(amt) };
      if(tag!==''){ tx.DestinationTag=Number(tag); }
      if(memo){ tx.Memos=[{ Memo:{ MemoData: xrpl.convertStringToHex(memo) } }]; }
      var prepared=await c.autofill(tx);
      var signed=state.wallet.sign(prepared);
      var res=await c.submitAndWait(signed.tx_blob);
      var code=res.result && res.result.meta && res.result.meta.TransactionResult;
      if(code==='tesSUCCESS'){
        $('sendOut').innerHTML='<span class="pill good">sent</span> <span class="muted">tx '+res.result.hash+'</span>';
        checkBalance();
      } else {
        $('sendOut').innerHTML='<span class="pill bad">'+(code||'failed')+'</span>';
      }
    }catch(e){ $('sendOut').innerHTML='<span class="pill bad">error</span> <span class="muted">'+e.message+'</span>'; }
    finally{ try{await c.disconnect()}catch(e){} }
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
