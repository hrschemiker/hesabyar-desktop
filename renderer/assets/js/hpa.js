(function(){
  function faToEn(s){return String(s||'').replace(/[۰-۹٠-٩]/g,function(d){return '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'.indexOf(d)%10;});}
  function normalizeDate(v){v=faToEn(v).replace(/[^0-9]/g,'');return v.length===8?v.slice(0,4)+'/'+v.slice(4,6)+'/'+v.slice(6,8):'';}
  function jalaliMonths(a,b){a=normalizeDate(a)||a;b=normalizeDate(b)||b;var ma=String(a).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/),mb=String(b).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);if(!ma||!mb)return 0;var n=(parseInt(mb[1])-parseInt(ma[1]))*12+(parseInt(mb[2])-parseInt(ma[2]))+1;return n>0?n:0;}
  document.addEventListener('DOMContentLoaded',function(){
    document.querySelectorAll('.hpa-toast').forEach(function(el){setTimeout(function(){el.style.opacity='0';el.style.transform='translateY(-8px)';setTimeout(function(){el.remove();},350);},5000);});
    try{var u=new URL(window.location.href); if(u.searchParams.has('hpa_msg')){u.searchParams.delete('hpa_msg'); window.history.replaceState({},'',u.toString()+window.location.hash);}}catch(e){}
    document.querySelectorAll('.hpa-jdate').forEach(function(inp){
      inp.setAttribute('inputmode','numeric');
      inp.addEventListener('blur',function(){var v=normalizeDate(inp.value); if(v) inp.value=v; updateLoanPreview();});
      inp.addEventListener('focus',function(){inp.placeholder='مثلاً 1403/02/15';});
    });
    function updateAssetFields(){
      document.querySelectorAll('form').forEach(function(f){
        var g=f.querySelector('[name="asset_group"]'); if(!g) return;
        var group=g.value;
        var q=f.querySelector('.hpa-asset-quantity-field'); var w=f.querySelector('.hpa-asset-weight-field');
        var purity=f.querySelector('.hpa-asset-purity-field'); var unit=f.querySelector('.hpa-asset-unit-field');
        var modelText=f.querySelector('.hpa-asset-model-text'); var modelCrypto=f.querySelector('.hpa-asset-model-crypto');
        if(q) q.style.display=(group==='gold')?'none':'grid';
        if(w) w.style.display=(['gold','silver'].indexOf(group)>-1)?'grid':'none';
        if(purity) purity.style.display=(group==='crypto')?'none':'grid';
        if(unit) unit.style.display=(group==='crypto')?'none':'grid';
        if(modelText) modelText.style.display=(group==='crypto')?'none':'grid';
        if(modelCrypto) modelCrypto.style.display=(group==='crypto')?'grid':'none';
        var price=parseFloat(faToEn((f.querySelector('[name="purchase_price"]')||{}).value).replace(/,/g,''))||0;
        var weight=parseFloat(faToEn((f.querySelector('[name="weight"]')||{}).value).replace(/,/g,''))||0;
        var qty=parseFloat(faToEn((f.querySelector('[name="quantity"]')||{}).value).replace(/,/g,''))||0;
        var base=(['gold','silver'].indexOf(group)>-1)?weight:(qty||weight);
        var prev=f.querySelector('.hpa-unit-price-preview'); if(prev) prev.textContent=base>0&&price>0?'قیمت واحد: '+Math.round(price/base).toLocaleString('fa-IR'):'قیمت واحد بعد از وارد کردن مقدار محاسبه می‌شود.';
      });
    }
    function updateLoanPreview(){
      document.querySelectorAll('form').forEach(function(f){
        var first=f.querySelector('[name="first_due_jalali_date"]'), last=f.querySelector('[name="last_due_jalali_date"]'); if(!first||!last)return;
        var n=jalaliMonths(first.value,last.value), p=f.querySelector('.hpa-loan-count-preview');
        if(!p){p=document.createElement('small');p.className='hpa-help hpa-loan-count-preview';last.parentNode.appendChild(p);}
        p.textContent=n?'تعداد اقساط محاسبه‌شده: '+n.toLocaleString('fa-IR')+' قسط':'بعد از ورود اولین و آخرین قسط، تعداد اقساط خودکار محاسبه می‌شود.';
      });
    }
    document.addEventListener('input',function(e){if(e.target.matches('[name="asset_group"],[name="purchase_price"],[name="weight"],[name="quantity"]')) updateAssetFields(); if(e.target.matches('[name="first_due_jalali_date"],[name="last_due_jalali_date"]')) updateLoanPreview();});
    document.addEventListener('change',function(e){if(e.target.matches('[name="asset_group"]')) updateAssetFields();});
    updateAssetFields(); updateLoanPreview();
  });
})();

/* v2.2 lightweight Jalali datepicker */
(function(){
  var activeInput=null, box=null, jy=0, jm=0;
  function faToEn(s){return String(s||'').replace(/[۰-۹٠-٩]/g,function(d){return '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'.indexOf(d)%10;});}
  function enToFa(s){return String(s).replace(/[0-9]/g,function(d){return '۰۱۲۳۴۵۶۷۸۹'[d];});}
  function norm(v){v=faToEn(v).replace(/[^0-9]/g,'');return v.length===8?v.slice(0,4)+'/'+v.slice(4,6)+'/'+v.slice(6,8):'';}
  function parts(v){v=norm(v)||faToEn(v);var m=String(v).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);return m?[parseInt(m[1]),parseInt(m[2]),parseInt(m[3])]:null;}
  function ml(y,m){return m<=6?31:(m<=11?30:29);}
  function pad(n){return String(n).padStart(2,'0');}
  function val(y,m,d){return y+'/'+pad(m)+'/'+pad(d);}
  function todayParts(){var first=document.querySelector('.hpa-jdate[value]');return parts(first&&first.value)||[1404,1,1];}
  function render(){
    if(!box||!activeInput)return; var picked=parts(activeInput.value); var title=enToFa(jy+'/'+pad(jm));
    var html='<div class="hpa-jdp-head"><button type="button" data-dir="next">‹</button><div class="hpa-jdp-title">'+title+'</div><button type="button" data-dir="prev">›</button></div>';
    html+='<div class="hpa-jdp-grid"><span>ش</span><span>ی</span><span>د</span><span>س</span><span>چ</span><span>پ</span><span>ج</span>';
    for(var d=1;d<=ml(jy,jm);d++){var cls=(picked&&picked[0]===jy&&picked[1]===jm&&picked[2]===d)?' class="is-picked"':'';html+='<button type="button" data-day="'+d+'"'+cls+'>'+enToFa(d)+'</button>';}
    html+='</div><div class="hpa-jdp-foot"><button type="button" data-today="1">امروز</button><button type="button" data-close="1">بستن</button></div>';
    box.innerHTML=html;
  }
  function position(){ if(!box||!activeInput)return; var r=activeInput.getBoundingClientRect(); box.style.top=(window.scrollY+r.bottom+8)+'px'; box.style.left=(window.scrollX+r.left)+'px'; }
  function open(inp){activeInput=inp; var p=parts(inp.value)||todayParts(); jy=p[0]; jm=p[1]; if(!box){box=document.createElement('div');box.className='hpa-jdp';document.body.appendChild(box);box.addEventListener('click',function(e){e.stopPropagation();var t=e.target.closest('button')||e.target;if(t.dataset.dir){if(t.dataset.dir==='next'){jm++;if(jm>12){jm=1;jy++;}}else{jm--;if(jm<1){jm=12;jy--;}}render();return;} if(t.dataset.day){activeInput.value=val(jy,jm,parseInt(t.dataset.day));activeInput.dispatchEvent(new Event('input',{bubbles:true}));activeInput.dispatchEvent(new Event('change',{bubbles:true}));activeInput.dispatchEvent(new CustomEvent('hpa:jdate-selected',{bubbles:true}));close();return;} if(t.dataset.today){var p=todayParts();activeInput.value=val(p[0],p[1],p[2]);activeInput.dispatchEvent(new Event('input',{bubbles:true}));activeInput.dispatchEvent(new Event('change',{bubbles:true}));activeInput.dispatchEvent(new CustomEvent('hpa:jdate-selected',{bubbles:true}));close();return;} if(t.dataset.close){close();return;}});} render(); position(); box.style.display='block';}
  function close(){ if(box) box.style.display='none'; activeInput=null; }
  document.addEventListener('focusin',function(e){if(e.target&&e.target.classList&&e.target.classList.contains('hpa-jdate')) open(e.target);});
  document.addEventListener('click',function(e){if(e.target&&e.target.classList&&e.target.classList.contains('hpa-jdate')) open(e.target);});
  document.addEventListener('click',function(e){if(box&&box.style.display==='block'&&!box.contains(e.target)&&e.target!==activeInput) close();});
  window.addEventListener('scroll',position,true); window.addEventListener('resize',position);
})();

/* v2.5 transaction UX: smart category filtering and anchor scroll */
(function(){
  function expenseLike(type){return ['expense','loan_installment','recurring_debt','debt_settlement','check_settlement','asset_buy'].indexOf(type)>-1;}
  function incomeLike(type){return ['income','receivable_settlement','asset_sell'].indexOf(type)>-1;}
  function updateTransactionCategory(form){
    var type=form.querySelector('select[name="type"]');
    var cat=form.querySelector('select[name="category_id"].hpa-category-by-type');
    if(!type||!cat)return;
    var wanted=incomeLike(type.value)?'income':(expenseLike(type.value)?'expense':'none');
    Array.prototype.forEach.call(cat.options,function(o){
      var t=o.getAttribute('data-cat-type')||'all';
      var show=(t==='all')||(wanted!=='none'&&t===wanted);
      o.hidden=!show; o.disabled=!show;
    });
    if(cat.selectedOptions.length && cat.selectedOptions[0].disabled) cat.value='0';
    cat.closest('label').style.display=(wanted==='none')?'none':'';
  }
  document.addEventListener('DOMContentLoaded',function(){
    document.querySelectorAll('form').forEach(updateTransactionCategory);
    document.querySelectorAll('select[name="type"]').forEach(function(sel){
      sel.addEventListener('change',function(){ updateTransactionCategory(sel.closest('form')); });
    });
    if(location.hash==='#hpa-transactions-list' || /[?&]hpa_(tag|category|q)=/.test(location.search)){
      var el=document.getElementById('hpa-transactions-list');
      if(el){setTimeout(function(){el.scrollIntoView({behavior:'smooth',block:'start'});},220);}
    }
  });
})();

/* v2.6.1 fixes based on v2.5: person transfer, loan toggle, variable installment UI */
(function(){
  function expenseLike(type){return ['expense','loan_installment','recurring_debt','debt_settlement','check_settlement','asset_buy'].indexOf(type)>-1;}
  function incomeLike(type){return ['income','receivable_settlement','asset_sell'].indexOf(type)>-1;}
  function updateTransactionUI(form){
    if(!form) return;
    var type=form.querySelector('select[name="type"]'); if(!type) return;
    var t=type.value;
    var isPerson=t==='person_transfer', isTransfer=t==='transfer';
    form.querySelectorAll('.hpa-person-transfer-field').forEach(function(el){el.style.display=isPerson?'grid':'none';});
    form.querySelectorAll('.hpa-person-normal-field').forEach(function(el){el.style.display=isPerson?'none':'grid';});
    form.querySelectorAll('.hpa-transfer-account-field').forEach(function(el){el.style.display=(isTransfer?'grid':'none');});
    form.querySelectorAll('.hpa-category-field').forEach(function(el){el.style.display=(isPerson||isTransfer)?'none':'grid';});
    form.querySelectorAll('.hpa-debt-settlement-field').forEach(function(el){el.style.display=(t==='debt_settlement')?'grid':'none';});
    form.querySelectorAll('.hpa-receivable-settlement-field').forEach(function(el){el.style.display=(t==='receivable_settlement')?'grid':'none';});
    form.querySelectorAll('.hpa-check-settlement-field').forEach(function(el){el.style.display=(t==='check_settlement')?'grid':'none';});
    form.querySelectorAll('.hpa-asset-link-field').forEach(function(el){el.style.display=(t==='asset_buy'||t==='asset_sell')?'grid':'none';});
    form.querySelectorAll('.hpa-recurring-debt-field').forEach(function(el){el.style.display=(t==='recurring_debt')?'grid':'none';});
    var cat=form.querySelector('select[name="category_id"].hpa-category-by-type');
    if(cat){
      var wanted=incomeLike(t)?'income':(expenseLike(t)?'expense':'none');
      Array.prototype.forEach.call(cat.options,function(o){var ct=o.getAttribute('data-cat-type')||'all'; var show=(ct==='all')||(wanted!=='none'&&ct===wanted); o.hidden=!show; o.disabled=!show;});
      if(wanted==='none') cat.value='0'; else if(cat.selectedOptions.length && cat.selectedOptions[0].disabled) cat.value='0';
    }
    var loanCheck=form.querySelector('input[name="hpa_is_loan_related"]');
    var showLoan=loanCheck && loanCheck.checked;
    form.querySelectorAll('.hpa-loan-related-field').forEach(function(el){el.style.display=showLoan?'grid':'none';});
  }
  function updateRecurringDueOptions(form){
    if(!form) return;
    var rec=form.querySelector('select[name="recurring_id"]');
    var due=form.querySelector('select[name="recurring_due_jalali_date"]');
    if(!rec||!due) return;
    var rid=rec.value||'0';
    var hidden=form.querySelector('input[name="recurring_due_recurring_id"]');
    if(hidden) hidden.value=(rid&&rid!=='0')?rid:'';
    Array.prototype.forEach.call(due.options,function(o){
      var dr=o.getAttribute('data-recurring');
      var show=!dr || dr===rid;
      o.hidden=!show; o.disabled=!show;
    });
    if(due.selectedOptions.length && due.selectedOptions[0].disabled) due.value='';
    var first=Array.prototype.find.call(due.options,function(o){return !o.disabled && o.value;});
    if(!due.value && first) due.value=first.value;
  }
  function updateVariableInstallment(form){
    if(!form)return;
    var cb=form.querySelector('input[name="variable_installments"]');
    var box=form.querySelector('.hpa-variable-installment-box');
    if(box) box.style.display=(cb&&cb.checked)?'grid':'none';
  }
  document.addEventListener('DOMContentLoaded',function(){
    document.querySelectorAll('form').forEach(function(f){updateTransactionUI(f);updateVariableInstallment(f);updateRecurringDueOptions(f);});
    document.addEventListener('change',function(e){
      if(e.target.matches('select[name="type"], input[name="hpa_is_loan_related"]')) updateTransactionUI(e.target.closest('form'));
      if(e.target.matches('select[name="recurring_id"]')){var f=e.target.closest('form'); updateRecurringDueOptions(f); var o=e.target.selectedOptions[0]; if(f&&o){var due=f.querySelector('select[name="recurring_due_jalali_date"]'); if(due&&!due.value) due.value=o.getAttribute('data-due')||''; var amount=f.querySelector('input[name="amount"]'); if(amount&&!amount.value) amount.value=o.getAttribute('data-amount')||''; var cur=f.querySelector('select[name="currency"]'); if(cur&&o.getAttribute('data-currency')) cur.value=o.getAttribute('data-currency');}}
      if(e.target.matches('select[name="recurring_due_jalali_date"]')){var f=e.target.closest('form'),o=e.target.selectedOptions[0];if(f&&o){var rid=o.getAttribute('data-recurring')||'';var rec=f.querySelector('select[name="recurring_id"]');var hidden=f.querySelector('input[name="recurring_due_recurring_id"]');if(rid&&rec)rec.value=rid;if(hidden)hidden.value=rid;}}
      if(e.target.matches('select[name="check_id"]')){var f=e.target.closest('form'); var o=e.target.selectedOptions[0]; if(f&&o){var amount=f.querySelector('input[name="amount"]'); if(amount&&!amount.value) amount.value=o.getAttribute('data-amount')||''; var cur=f.querySelector('select[name="currency"]'); if(cur&&o.getAttribute('data-currency')) cur.value=o.getAttribute('data-currency');}}
      if(e.target.matches('input[name="variable_installments"]')) updateVariableInstallment(e.target.closest('form'));
    });
  });
})();

/* v3.2 mobile transaction wizard: auto advance + sticky bottom actions */
(function(){
  function isMobile(){ return window.matchMedia('(max-width:780px)').matches; }
  function visible(el){ return el && !(el.offsetParent===null) && getComputedStyle(el).display!=='none'; }
  function fieldObj(name, title, optional){ return {name:name,title:title,optional:!!optional}; }
  function findForm(){ var t=document.querySelector('input[name="action"][value="hpa_save_transaction"], input[name="hpa_action"][value="hpa_save_transaction"]'); return t ? t.closest('form') : null; }
  function fieldLabel(form, name){ var el=form.querySelector('[name="'+name+'"]'); return el ? el.closest('label') : null; }
  function currentSteps(form){
    if(!form) return [];
    var type=(form.querySelector('select[name="type"]')||{}).value || 'expense';
    var steps=[fieldObj('type','نوع تراکنش')];
    if(type!=='person_transfer') steps.push(fieldObj('person_key','شخص'));
    if(['income','expense','recurring_debt','debt_settlement','receivable_settlement','check_settlement','asset_buy','asset_sell'].indexOf(type)>-1) steps.push(fieldObj('category_id','موضوع',false));
    steps.push(fieldObj('account_id','حساب مرتبط'));
    if(type==='transfer') steps.push(fieldObj('to_account_id','حساب مقصد'));
    if(type==='person_transfer') steps.push(fieldObj('from_person_key','مبدأ پول'), fieldObj('to_person_key','مقصد پول'));
    if(type==='transfer'||type==='person_transfer') steps.push(fieldObj('fee_amount','کارمزد انتقال',true));
    steps.push(fieldObj('amount','مبلغ'), fieldObj('currency','واحد پول'), fieldObj('jalali_date','تاریخ شمسی'));
    if(type==='debt_settlement') steps.push(fieldObj('debt_id','بدهی مرتبط'));
    if(type==='receivable_settlement') steps.push(fieldObj('receivable_id','طلب مرتبط'));
    if(type==='check_settlement') steps.push(fieldObj('check_id','چک مرتبط'));
    if(type==='asset_buy'||type==='asset_sell') steps.push(fieldObj('asset_id','دارایی مرتبط'));
    if(type==='asset_sell') steps.push(fieldObj('asset_quantity','مقدار فروخته‌شده',true));
    if(type==='recurring_debt') steps.push(fieldObj('recurring_id','بدهی تکرارشونده'), fieldObj('recurring_due_jalali_date','تاریخ سررسید'));
    if(type==='loan_installment'){ steps.push(fieldObj('loan_installment_id','قسط مرتبط')); }
    else { steps.push(fieldObj('hpa_is_loan_related','تراکنش وام/قسط است؟',true)); if((form.querySelector('input[name="hpa_is_loan_related"]')||{}).checked) steps.push(fieldObj('source_loan_id','وام مرتبط',true), fieldObj('loan_installment_id','قسط مرتبط',true)); }
    var split=(form.querySelector('input[name="hpa_split_categories"]')||{}).checked;
    steps.push(fieldObj('hpa_split_categories','تقسیم مبلغ بین چند موضوع',true));
    if(split) steps.push(fieldObj('split_category_id_2','موضوع دوم',true),fieldObj('split_amount_2','مبلغ موضوع دوم',true),fieldObj('split_category_id_3','موضوع سوم',true),fieldObj('split_amount_3','مبلغ موضوع سوم',true));
    steps.push(fieldObj('transaction_place','محل تراکنش',true), fieldObj('hide_amount','پنهان‌کردن مبلغ',true), fieldObj('status','وضعیت',true), fieldObj('tags','برچسب‌ها',true), fieldObj('hpa_items','اقلام خرید (نام + قیمت)',true), fieldObj('description','توضیح',true), fieldObj('receipt[]','رسید/پیوست',true));
    return steps.filter(function(st){ var lab=fieldLabel(form,st.name); return st.name==='hpa_is_loan_related' || st.name==='receipt[]' || st.name==='hpa_items' || st.name==='tags' || visible(lab) || !!form.querySelector('[name="'+st.name+'"]'); });
  }
  function isChoiceStep(source){ return source && (source.tagName==='SELECT' || source.type==='checkbox' || source.type==='file' || source.classList.contains('hpa-jdate')); }
  function controlFor(form, step, onChanged){
    var source=form.querySelector('[name="'+step.name+'"]');
    var wrap=document.createElement('div'); wrap.className='hpa-wizard-control';
    if(step.name==='hpa_items'){ var ibox=document.createElement('div'); ibox.className='hpa-items-editor'; var ihid=form.querySelector('input[name="hpa_items"]'); ibox.setAttribute('data-items',(ihid&&ihid.value)||'[]'); wrap.appendChild(ibox); if(window.hpaInitItems) window.hpaInitItems(ibox, ihid); return wrap; }
    if(step.name==='tags'){
      var hidT=form.querySelector('input[name="tags"]'); if(!hidT){ wrap.innerHTML='<p class="hpa-muted">—</p>'; return wrap; }
      var chips=document.createElement('div'); chips.className='hpa-tag-chips';
      var tf=document.createElement('input'); tf.type='text'; tf.className='hpa-tag-entry hpa-wizard-input'; tf.placeholder='برچسب و Enter'; tf.setAttribute('autocomplete','off');
      var tg=function(){return (hidT.value||'').split(',').map(function(t){return t.trim();}).filter(Boolean);};
      var rnd=function(){chips.innerHTML='';tg().forEach(function(t,i){var c=document.createElement('span');c.className='hpa-tag-chip';c.innerHTML='<b>#'+t.replace(/</g,'&lt;')+'</b><button type="button">×</button>';c.querySelector('button').onclick=function(){var l=tg();l.splice(i,1);hidT.value=l.join(',');rnd();};chips.appendChild(c);});};
      tf.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===','){e.preventDefault();var v=tf.value.trim().replace(/^#/,'');if(v){var l=tg();if(l.indexOf(v)<0){l.push(v);hidT.value=l.join(',');}tf.value='';rnd();}}});
      wrap.appendChild(chips); wrap.appendChild(tf); rnd(); setTimeout(function(){try{tf.focus();}catch(e){}},60); return wrap;
    }
    if(!source){ wrap.innerHTML='<p class="hpa-muted">این مرحله در این نوع تراکنش لازم نیست.</p>'; return wrap; }
    if(source.tagName==='SELECT'){
      var list=document.createElement('div'); list.className='hpa-wizard-options';
      Array.prototype.forEach.call(source.options,function(o){
        if(o.disabled||o.hidden) return;
        if((step.name==='account_id'||step.name==='to_account_id') && (o.value==='0'||o.value==='')) return;
        var b=document.createElement('button'); b.type='button'; b.className='hpa-wizard-option'+(o.selected?' is-selected':'');
        b.textContent=o.textContent;
        b.onclick=function(){ source.value=o.value; source.dispatchEvent(new Event('change',{bubbles:true})); setTimeout(function(){onChanged(true);},120); };
        list.appendChild(b);
      });
      if(!list.children.length){ var empty=document.createElement('p'); empty.className='hpa-muted'; empty.textContent='گزینه‌ای برای انتخاب وجود ندارد.'; list.appendChild(empty); }
      wrap.appendChild(list); return wrap;
    }
    if(source.type==='checkbox'){
      var bYes=document.createElement('button'), bNo=document.createElement('button');
      bYes.type=bNo.type='button'; bYes.className='hpa-wizard-option'+(source.checked?' is-selected':''); bNo.className='hpa-wizard-option'+(!source.checked?' is-selected':'');
      bYes.textContent='بله'; bNo.textContent='خیر / فعلاً نه';
      bYes.onclick=function(){source.checked=true; source.dispatchEvent(new Event('change',{bubbles:true})); setTimeout(function(){onChanged(true)},120)};
      bNo.onclick=function(){source.checked=false; source.dispatchEvent(new Event('change',{bubbles:true})); setTimeout(function(){onChanged(true)},120)};
      wrap.className+=' hpa-wizard-options'; wrap.appendChild(bYes); wrap.appendChild(bNo); return wrap;
    }
    var clone=source.cloneNode(true); clone.removeAttribute('id'); clone.classList.add('hpa-wizard-input'); clone.value=source.value||'';
    if(clone.type==='file') clone.removeAttribute('required');
    clone.addEventListener('input',function(){ if(source.type!=='file') source.value=clone.value; source.dispatchEvent(new Event('input',{bubbles:true})); });
    clone.addEventListener('change',function(){ if(source.type==='file'){ try{ source.files=clone.files; }catch(e){} } else { source.value=clone.value; } source.dispatchEvent(new Event('change',{bubbles:true})); if(clone.classList.contains('hpa-jdate') || source.type==='file') setTimeout(function(){onChanged(true)},120); });
    clone.addEventListener('hpa:jdate-selected',function(){ source.value=clone.value; source.dispatchEvent(new Event('change',{bubbles:true})); setTimeout(function(){onChanged(true)},120); });
    clone.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); source.value=clone.value; onChanged(true); }});
    wrap.appendChild(clone);
    if(source.classList.contains('hpa-jdate')){ var help=document.createElement('small'); help.className='hpa-help'; help.textContent='با انتخاب تاریخ، مرحله بعد خودکار باز می‌شود.'; wrap.appendChild(help); }
    else { var help2=document.createElement('small'); help2.className='hpa-help'; help2.textContent='بعد از وارد کردن مقدار، دکمه ثبت این مرحله را بزن یا Enter را بزن.'; wrap.appendChild(help2); }
    setTimeout(function(){try{ if(clone.classList.contains('hpa-jdate')) { clone.click(); } else if(source.name!=='description' && source.name!=='transaction_place') { clone.focus(); } }catch(e){}},80);
    return wrap;
  }
  function initWizard(){
    var form=findForm(); if(!form || form.dataset.wizardReady) return; form.dataset.wizardReady='1';
    var launch=document.createElement('button'); launch.type='button'; launch.className='hpa-btn hpa-btn-primary hpa-mobile-wizard-launch'; launch.id='hpa-mobile-wizard-launch'; launch.textContent='ثبت تراکنش';
    form.parentNode.insertBefore(launch, form);
    var overlay=document.createElement('div'); overlay.className='hpa-transaction-wizard'; overlay.innerHTML='<div class="hpa-wizard-head"><div><strong>ثبت مرحله‌ای تراکنش</strong><small>گزینه را انتخاب کن؛ مرحله بعد خودکار باز می‌شود</small></div><button type="button" class="hpa-wizard-list">نمایش تراکنش‌های قبلی</button></div><div class="hpa-wizard-progress"><span></span></div><div class="hpa-wizard-body"><h3></h3><div class="hpa-wizard-slot"></div></div><div class="hpa-wizard-foot"><button type="button" class="hpa-wizard-skip">رد کردن</button><button type="button" class="hpa-wizard-prev">مرحله قبلی</button><button type="button" class="hpa-wizard-cancel">انصراف</button><button type="button" class="hpa-wizard-next">ثبت این مرحله</button></div>';
    document.body.appendChild(overlay);
    var idx=0;
    function goNext(){ var steps=currentSteps(form); if(idx>=steps.length-1){ var submit=form.querySelector('button[type="submit"],input[type="submit"]'); if(submit){ submit.click(); } else if(form.requestSubmit){ form.requestSubmit(); } else { form.submit(); } } else { idx++; render(); } }
    function render(){
      var steps=currentSteps(form); if(idx<0) idx=0; if(idx>=steps.length) idx=steps.length-1;
      var st=steps[idx]; var src=form.querySelector('[name="'+st.name+'"]'); overlay.querySelector('h3').textContent=st.title;
      var slot=overlay.querySelector('.hpa-wizard-slot'); slot.innerHTML=''; slot.appendChild(controlFor(form,st,function(){ goNext(); }));
      overlay.querySelector('.hpa-wizard-progress span').style.width=((idx+1)/Math.max(1,steps.length)*100)+'%';
      overlay.querySelector('.hpa-wizard-prev').disabled=idx===0;
      var next=overlay.querySelector('.hpa-wizard-next');
      var choice=isChoiceStep(src);
      next.style.display=choice ? 'none' : 'block';
      next.textContent=(idx>=steps.length-1)?'ثبت تراکنش':'ثبت این مرحله';
      overlay.querySelector('.hpa-wizard-body').scrollTop=0;
    }
    launch.onclick=function(){ if(!isMobile()) return; idx=0; overlay.classList.add('is-open'); document.documentElement.classList.add('hpa-no-scroll'); render(); };
    overlay.querySelector('.hpa-wizard-cancel').onclick=function(){ overlay.classList.remove('is-open'); document.documentElement.classList.remove('hpa-no-scroll'); };
    overlay.querySelector('.hpa-wizard-prev').onclick=function(){ idx--; render(); };
    overlay.querySelector('.hpa-wizard-skip').onclick=function(){ goNext(); };
    overlay.querySelector('.hpa-wizard-next').onclick=function(){ goNext(); };
    overlay.querySelector('.hpa-wizard-list').onclick=function(){ overlay.classList.remove('is-open'); document.documentElement.classList.remove('hpa-no-scroll'); var el=document.getElementById('hpa-transactions-list'); if(el) setTimeout(function(){el.scrollIntoView({behavior:'smooth',block:'start'});},120); };
    if(isMobile() && /[?&]hpa_tab=transactions/.test(location.search)){ setTimeout(function(){ launch.scrollIntoView({behavior:'smooth',block:'center'}); },350); }
  }
  document.addEventListener('DOMContentLoaded',initWizard);
})();


/* v3.3 final mobile wizard button + debt/receivable card lists */
(function(){
  function enhanceWizardFinal(){
    var overlay=document.querySelector('.hpa-transaction-wizard');
    if(!overlay || overlay.dataset.v33Ready) return;
    overlay.dataset.v33Ready='1';
    var body=overlay.querySelector('.hpa-wizard-body');
    var foot=overlay.querySelector('.hpa-wizard-foot');
    var next=overlay.querySelector('.hpa-wizard-next');
    if(!body || !foot || !next) return;
    var obs=new MutationObserver(function(){
      var final = (next.textContent||'').indexOf('ثبت تراکنش')>-1;
      overlay.classList.toggle('hpa-wizard-is-final', final);
      var slot=overlay.querySelector('.hpa-wizard-slot');
      if(final && slot && !slot.querySelector('.hpa-wizard-final-submit')){
        var btn=document.createElement('button');
        btn.type='button'; btn.className='hpa-btn hpa-btn-primary hpa-wizard-final-submit';
        btn.textContent='ثبت تراکنش';
        btn.onclick=function(){ next.click(); };
        slot.appendChild(btn);
        setTimeout(function(){ try{btn.scrollIntoView({behavior:'smooth',block:'center'});}catch(e){} },80);
      }
      if(!final && slot){ var old=slot.querySelector('.hpa-wizard-final-submit'); if(old) old.remove(); }
    });
    obs.observe(next,{childList:true,characterData:true,subtree:true,attributes:true});
    obs.observe(overlay.querySelector('.hpa-wizard-slot')||body,{childList:true,subtree:true});
  }
  function cardifyDebtTables(){
    document.querySelectorAll('.hpa-card').forEach(function(section){
      var h=(section.querySelector('h2,h3')||{}).textContent||'';
      if(!/(بدهی|طلب|وام|قسط|چک|تکرارشونده)/.test(h)) return;
      section.querySelectorAll('.hpa-table-wrap').forEach(function(wrap){
        if(wrap.dataset.cardified) return;
        var table=wrap.querySelector('table'); if(!table) return;
        var heads=[].map.call(table.querySelectorAll('thead th'),function(th){return th.textContent.trim();});
        var rows=table.querySelectorAll('tbody tr'); if(!rows.length) return;
        var cards=document.createElement('div'); cards.className='hpa-debt-card-list';
        rows.forEach(function(tr){
          var cells=[].slice.call(tr.children); if(!cells.length || (cells.length===1 && /ثبت نشده|وجود ندارد|هنوز/.test(cells[0].textContent))) return;
          var title=(cells[0]&&cells[0].textContent.trim())||h;
          var amount=''; for(var i=0;i<cells.length;i++){ if(/مبلغ|وام|اصل|باقی|طلب|بدهی|قسط|چک/.test(heads[i]||'') && !amount) amount=cells[i].textContent.trim(); }
          var due=''; for(var j=0;j<cells.length;j++){ if(/تاریخ|موعد|آخرین|اولین/.test(heads[j]||'') && !due) due=cells[j].textContent.trim(); }
          var det=document.createElement('details'); det.className='hpa-debt-like-card';
          if(tr.classList.contains('hpa-debt-paid-row') || tr.getAttribute('data-paid')==='1'){det.classList.add('hpa-debt-paid-row');det.setAttribute('data-paid','1');}
          var summary=document.createElement('summary'); summary.innerHTML='<span class="hpa-debt-icon">'+(h.indexOf('طلب')>-1?'🤝':h.indexOf('وام')>-1?'🏦':h.indexOf('چک')>-1?'🧾':h.indexOf('تکرار')>-1?'🔁':'📉')+'</span><span class="hpa-debt-main"><b></b><small></small></span><em></em>';
          summary.querySelector('b').textContent=title;
          summary.querySelector('small').textContent=due||'جزئیات بیشتر';
          summary.querySelector('em').textContent=amount||'';
          var details=document.createElement('div'); details.className='hpa-debt-details';
          cells.forEach(function(td,idx){ var label=heads[idx]||('ستون '+(idx+1)); if(!td.textContent.trim()) return; var p=document.createElement('p'); p.innerHTML='<strong></strong><span></span>'; p.querySelector('strong').textContent=label+': '; p.querySelector('span').innerHTML=td.innerHTML; details.appendChild(p); });
          det.appendChild(summary); det.appendChild(details); cards.appendChild(det);
        });
        if(cards.children.length){ wrap.parentNode.insertBefore(cards,wrap); wrap.style.display='none'; wrap.dataset.cardified='1'; }
      });
    });
  }
  document.addEventListener('DOMContentLoaded',function(){ setTimeout(enhanceWizardFinal,300); setTimeout(cardifyDebtTables,350); });
  document.addEventListener('click',function(){ setTimeout(enhanceWizardFinal,80); setTimeout(cardifyDebtTables,120); });
})();

/* v3.4 mobile/app parity fixes: installments, fee, no mobile keyboard, mobile asset wizard */
(function(){
  function isMobile(){return window.matchMedia && window.matchMedia('(max-width:780px)').matches;}
  function qs(sel,root){return (root||document).querySelector(sel)}
  function qsa(sel,root){return Array.prototype.slice.call((root||document).querySelectorAll(sel))}
  function show(el,on){if(el) el.style.display=on?'grid':'none'}
  function txForm(){var t=qs('input[name="hpa_action"][value="hpa_save_transaction"],input[name="action"][value="hpa_save_transaction"]');return t?t.closest('form'):null}
  function updateTxUI(form){
    form=form||txForm(); if(!form) return;
    var type=qs('select[name="type"]',form); if(!type) return; var t=type.value;
    qsa('.hpa-transfer-fee-field',form).forEach(function(el){show(el,t==='transfer'||t==='person_transfer')});
    qsa('.hpa-check-settlement-field',form).forEach(function(el){show(el,t==='check_settlement')});
    qsa('.hpa-loan-toggle-field',form).forEach(function(el){show(el, t!=='loan_installment')});
    var cb=qs('input[name="hpa_is_loan_related"]',form); var checked=cb&&cb.checked;
    qsa('.hpa-source-loan-field',form).forEach(function(el){show(el, checked && t!=='loan_installment')});
    qsa('.hpa-installment-field',form).forEach(function(el){show(el, checked || t==='loan_installment')});
    if(t==='loan_installment'){
      qsa('.hpa-category-field',form).forEach(function(el){show(el,false)});
      var cat=qs('select[name="category_id"]',form); if(cat) cat.value='0';
    }
  }
  document.addEventListener('DOMContentLoaded',function(){qsa('form').forEach(updateTxUI);});
  document.addEventListener('change',function(e){if(e.target.matches('select[name="type"],input[name="hpa_is_loan_related"]')) updateTxUI(e.target.closest('form'));});

  function preventAutoKeyboard(){
    if(!isMobile()) return;
    qsa('.hpa-transaction-wizard input.hpa-jdate,.hpa-transaction-wizard textarea,.hpa-asset-wizard input.hpa-jdate,.hpa-asset-wizard textarea').forEach(function(el){
      if(el.classList.contains('hpa-jdate')) el.setAttribute('readonly','readonly');
      el.setAttribute('autocomplete','off'); el.setAttribute('autocorrect','off'); el.setAttribute('autocapitalize','off'); el.setAttribute('spellcheck','false');
    });
  }
  var mo=new MutationObserver(preventAutoKeyboard); mo.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',preventAutoKeyboard);

  function assetForm(){var t=qs('input[name="hpa_action"][value="hpa_save_asset"],input[name="action"][value="hpa_save_asset"]');return t?t.closest('form'):null}
  function field(form,name){var el=qs('[name="'+name+'"]',form);return el?el.closest('label'):null}
  function assetSteps(form){return [
    ['title','عنوان دارایی',false],['person_key','شخص',false],['asset_group','نوع دارایی',false],['model','مدل/نوع',true],['model_crypto','نوع کریپتو',true],['purity','عیار/خلوص',true],['weight','وزن',true],['quantity','تعداد/مقدار',true],['unit','واحد',true],['purchase_price','قیمت خرید کل',false],['currency','واحد پول',false],['jalali_date','تاریخ خرید',false],['purchase_place','محل خرید',true],['source_loan_id','وام تأمین‌کننده',true],['receipt[]','رسید خرید',true],['note','توضیح',true]
  ].filter(function(s){var el=qs('[name="'+s[0]+'"]',form);var lab=field(form,s[0]);return !!el && (!lab || lab.style.display!=='none');});}
  function makeControl(source,onNext){var wrap=document.createElement('div');wrap.className='hpa-wizard-control';
    if(source.tagName==='SELECT'){var list=document.createElement('div');list.className='hpa-wizard-options';Array.prototype.forEach.call(source.options,function(o){if(o.disabled||o.hidden)return;var b=document.createElement('button');b.type='button';b.className='hpa-wizard-option'+(o.selected?' is-selected':'');b.textContent=o.textContent;b.onclick=function(){source.value=o.value;source.dispatchEvent(new Event('change',{bubbles:true}));setTimeout(onNext,100)};list.appendChild(b)});wrap.appendChild(list);return wrap;}
    var clone=source.cloneNode(true);clone.removeAttribute('id');clone.classList.add('hpa-wizard-input');clone.value=source.value||'';clone.setAttribute('autocomplete','off'); if(clone.classList.contains('hpa-jdate')) clone.setAttribute('readonly','readonly');
    clone.addEventListener('input',function(){ if(source.type!=='file') source.value=clone.value; source.dispatchEvent(new Event('input',{bubbles:true})); });
    clone.addEventListener('change',function(){ if(source.type==='file'){try{source.files=clone.files}catch(e){}} else source.value=clone.value; source.dispatchEvent(new Event('change',{bubbles:true})); if(source.type==='file'||clone.classList.contains('hpa-jdate')) setTimeout(onNext,100); });
    clone.addEventListener('hpa:jdate-selected',function(){source.value=clone.value;source.dispatchEvent(new Event('change',{bubbles:true}));setTimeout(onNext,100)});
    clone.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();source.value=clone.value;onNext();}});
    wrap.appendChild(clone); var small=document.createElement('small');small.className='hpa-help';small.textContent=clone.classList.contains('hpa-jdate')?'با انتخاب تاریخ، مرحله بعد خودکار باز می‌شود.':'بعد از ورود مقدار، ثبت این مرحله را بزن.';wrap.appendChild(small);
    setTimeout(function(){try{ if(clone.classList.contains('hpa-jdate')) clone.click(); else if(source.tagName!=='TEXTAREA') clone.focus(); }catch(e){}},70);
    return wrap;}
  function initAssetWizard(){var form=assetForm(); if(!form||form.dataset.assetWizardReady)return; form.dataset.assetWizardReady='1';
    var launch=document.createElement('button');launch.type='button';launch.className='hpa-btn hpa-btn-primary hpa-mobile-asset-wizard-launch';launch.textContent='ثبت دارایی';form.parentNode.insertBefore(launch,form);
    var overlay=document.createElement('div');overlay.className='hpa-transaction-wizard hpa-asset-wizard';overlay.innerHTML='<div class="hpa-wizard-head"><div><strong>ثبت مرحله‌ای دارایی</strong><small>گزینه را انتخاب کن؛ مرحله بعد خودکار باز می‌شود</small></div><button type="button" class="hpa-wizard-list">نمایش دارایی‌های ثبت‌شده</button></div><div class="hpa-wizard-progress"><span></span></div><div class="hpa-wizard-body"><h3></h3><div class="hpa-wizard-slot"></div></div><div class="hpa-wizard-foot"><button type="button" class="hpa-wizard-skip">رد کردن</button><button type="button" class="hpa-wizard-prev">مرحله قبلی</button><button type="button" class="hpa-wizard-cancel">انصراف</button><button type="button" class="hpa-wizard-next">ثبت این مرحله</button></div>';document.body.appendChild(overlay);var idx=0;
    function goNext(){var st=assetSteps(form); if(idx>=st.length-1){form.requestSubmit?form.requestSubmit():form.submit()} else {idx++;render();}}
    function render(){var st=assetSteps(form); if(idx<0)idx=0;if(idx>=st.length)idx=st.length-1;var cur=st[idx], src=qs('[name="'+cur[0]+'"]',form);overlay.querySelector('h3').textContent=cur[1];var slot=overlay.querySelector('.hpa-wizard-slot');slot.innerHTML='';slot.appendChild(makeControl(src,goNext));overlay.querySelector('.hpa-wizard-progress span').style.width=((idx+1)/Math.max(1,st.length)*100)+'%';overlay.querySelector('.hpa-wizard-prev').disabled=idx===0;var next=overlay.querySelector('.hpa-wizard-next');var choice=src&&(src.tagName==='SELECT'||src.type==='file'||src.classList.contains('hpa-jdate'));next.style.display=choice?'none':'block';next.textContent=(idx>=st.length-1)?'ثبت دارایی':'ثبت این مرحله';overlay.classList.toggle('hpa-wizard-is-final',idx>=st.length-1);var slot2=overlay.querySelector('.hpa-wizard-slot');if(idx>=st.length-1&&!slot2.querySelector('.hpa-wizard-final-submit')){var b=document.createElement('button');b.type='button';b.className='hpa-btn hpa-btn-primary hpa-wizard-final-submit';b.textContent='ثبت دارایی';b.onclick=function(){form.requestSubmit?form.requestSubmit():form.submit()};slot2.appendChild(b)}}
    launch.onclick=function(){idx=0;overlay.classList.add('is-open');document.documentElement.classList.add('hpa-no-scroll');render()};overlay.querySelector('.hpa-wizard-cancel').onclick=function(){overlay.classList.remove('is-open');document.documentElement.classList.remove('hpa-no-scroll')};overlay.querySelector('.hpa-wizard-prev').onclick=function(){idx--;render()};overlay.querySelector('.hpa-wizard-skip').onclick=goNext;overlay.querySelector('.hpa-wizard-next').onclick=goNext;overlay.querySelector('.hpa-wizard-list').onclick=function(){overlay.classList.remove('is-open');document.documentElement.classList.remove('hpa-no-scroll');var el=qs('.hpa-asset-card-list');if(el)setTimeout(function(){el.scrollIntoView({behavior:'smooth',block:'start'})},120)};
    if(isMobile()&&/[?&]hpa_tab=assets/.test(location.search)){setTimeout(function(){var list=qs('.hpa-asset-card-list'); if(list) list.scrollIntoView({behavior:'smooth',block:'start'});},350)}
  }
  document.addEventListener('DOMContentLoaded',initAssetWizard);
})();


/* v3.5 fixes: reliable datepicker arrows, mobile transaction place, safer final submit */
(function(){
  document.addEventListener('pointerdown',function(e){
    var btn=e.target && e.target.closest ? e.target.closest('.hpa-jdp button') : null;
    if(btn){ e.stopPropagation(); }
  },true);
  document.addEventListener('DOMContentLoaded',function(){
    document.querySelectorAll('input[name="transaction_place"]').forEach(function(el){
      el.setAttribute('autocomplete','off');
      el.setAttribute('autocorrect','off');
      el.setAttribute('autocapitalize','off');
    });
  });
})();


/* v3.6 fixes: restore mobile category step and robust datepicker arrows */
(function(){
  function qs(sel,root){return (root||document).querySelector(sel)}
  function qsa(sel,root){return Array.prototype.slice.call((root||document).querySelectorAll(sel))}
  function txForm(){var t=qs('input[name="hpa_action"][value="hpa_save_transaction"],input[name="action"][value="hpa_save_transaction"]');return t?t.closest('form'):null}
  function expenseLike(t){return ['expense','loan_installment','recurring_debt','debt_settlement','check_settlement','asset_buy'].indexOf(t)>-1}
  function incomeLike(t){return ['income','receivable_settlement','asset_sell'].indexOf(t)>-1}
  function syncCategory(form){
    form=form||txForm(); if(!form) return;
    var sel=qs('select[name="type"]',form), cat=qs('select[name="category_id"]',form); if(!sel||!cat) return;
    var t=sel.value, needs=['income','expense','recurring_debt','debt_settlement','receivable_settlement','check_settlement','asset_buy','asset_sell'].indexOf(t)>-1;
    qsa('.hpa-category-field',form).forEach(function(el){el.style.display=needs?'grid':'none'});
    var wanted=incomeLike(t)?'income':(expenseLike(t)?'expense':'none');
    Array.prototype.forEach.call(cat.options,function(o){var ct=o.getAttribute('data-cat-type')||'all'; var ok=(ct==='all')||(wanted!=='none'&&ct===wanted); o.hidden=!ok; o.disabled=!ok;});
    if(!needs) cat.value='0';
    else if(cat.selectedOptions.length && cat.selectedOptions[0].disabled) cat.value='0';
  }
  document.addEventListener('DOMContentLoaded',function(){syncCategory(); setTimeout(syncCategory,200);});
  document.addEventListener('change',function(e){ if(e.target && e.target.matches && e.target.matches('select[name="type"]')) setTimeout(function(){syncCategory(e.target.closest('form'))},30); }, true);
  document.addEventListener('click',function(e){ if(e.target && e.target.closest && e.target.closest('.hpa-wizard-option')) setTimeout(function(){syncCategory()},60); }, true);

  var active=null, jy=0, jm=0;
  function faToEn(s){return String(s||'').replace(/[۰-۹٠-٩]/g,function(d){return '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'.indexOf(d)%10;});}
  function enToFa(s){return String(s).replace(/[0-9]/g,function(d){return '۰۱۲۳۴۵۶۷۸۹'[d];});}
  function pad(n){return String(n).padStart(2,'0')}
  function val(y,m,d){return y+'/'+pad(m)+'/'+pad(d)}
  function parts(v){v=faToEn(v).replace(/[^0-9\/]/g,'');var m=String(v).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);return m?[parseInt(m[1]),parseInt(m[2]),parseInt(m[3])]:null;}
  function ml(y,m){return m<=6?31:(m<=11?30:29)}
  function setActive(inp){active=inp; var p=parts(inp.value)||[1404,1,1]; jy=p[0]; jm=p[1];}
  function renderBox(box){
    if(!box) return; var picked=active?parts(active.value):null;
    var html='<div class="hpa-jdp-head"><button type="button" data-dir="next">‹</button><div class="hpa-jdp-title">'+enToFa(jy+'/'+pad(jm))+'</div><button type="button" data-dir="prev">›</button></div>';
    html+='<div class="hpa-jdp-grid"><span>ش</span><span>ی</span><span>د</span><span>س</span><span>چ</span><span>پ</span><span>ج</span>';
    for(var d=1; d<=ml(jy,jm); d++){var cls=(picked&&picked[0]===jy&&picked[1]===jm&&picked[2]===d)?' class="is-picked"':''; html+='<button type="button" data-day="'+d+'"'+cls+'>'+enToFa(d)+'</button>';}
    html+='</div><div class="hpa-jdp-foot"><button type="button" data-today="1">امروز</button><button type="button" data-close="1">بستن</button></div>';
    box.innerHTML=html;
  }
  document.addEventListener('focusin',function(e){if(e.target&&e.target.classList&&e.target.classList.contains('hpa-jdate')) setActive(e.target);},true);
  document.addEventListener('click',function(e){if(e.target&&e.target.classList&&e.target.classList.contains('hpa-jdate')) setActive(e.target);},true);
  document.addEventListener('click',function(e){
    var box=e.target && e.target.closest ? e.target.closest('.hpa-jdp') : null; if(!box) return;
    var btn=e.target.closest('button'); if(!btn) return;
    if(!active) active=document.querySelector('.hpa-jdate:focus')||document.querySelector('.hpa-jdate');
    if(btn.dataset.dir){e.preventDefault();e.stopImmediatePropagation(); if(btn.dataset.dir==='next'){jm++; if(jm>12){jm=1;jy++;}} else {jm--; if(jm<1){jm=12;jy--;}} renderBox(box); return;}
    if(btn.dataset.day){e.preventDefault();e.stopImmediatePropagation(); if(active){active.value=val(jy,jm,parseInt(btn.dataset.day)); active.dispatchEvent(new Event('input',{bubbles:true})); active.dispatchEvent(new Event('change',{bubbles:true})); active.dispatchEvent(new CustomEvent('hpa:jdate-selected',{bubbles:true}));} box.style.display='none'; return;}
    if(btn.dataset.close){e.preventDefault();e.stopImmediatePropagation(); box.style.display='none'; return;}
  },true);
})();

/* v3.7 reports/splits/goals lightweight UX */
(function(){
  document.addEventListener('DOMContentLoaded',function(){
    function toggleSplits(form){
      var cb=form.querySelector('input[name="hpa_split_categories"]');
      form.querySelectorAll('.hpa-split-field').forEach(function(el){el.style.display=(cb&&cb.checked)?'grid':'none';});
    }
    document.querySelectorAll('form').forEach(toggleSplits);
    document.addEventListener('change',function(e){
      if(e.target && e.target.name==='hpa_split_categories') toggleSplits(e.target.closest('form'));
    });
    document.querySelectorAll('.hpa-show-more-cards').forEach(function(btn){
      btn.addEventListener('click',function(){
        var box=btn.closest('.hpa-card')||document;
        var hidden=Array.prototype.slice.call(box.querySelectorAll('.hpa-lazy-more-item')).filter(function(el){return el.style.display==='none' || getComputedStyle(el).display==='none';});
        hidden.slice(0,5).forEach(function(el){el.style.display='block';});
        if(hidden.length<=5) btn.style.display='none';
      });
    });
    document.querySelectorAll('.hpa-lazy-more-item').forEach(function(el){el.style.display='none';});
  });
})();


/* v3.8 edit auto-scroll */
(function(){
  document.addEventListener('DOMContentLoaded',function(){
    try{
      var params=new URLSearchParams(window.location.search);
      var editKeys=['hpa_edit_account','hpa_edit_transaction','hpa_edit_asset','hpa_edit_category','hpa_edit_debt','hpa_edit_receivable','hpa_edit_loan','hpa_edit_check','hpa_edit_recurring'];
      var hasEdit=editKeys.some(function(k){return params.has(k);});
      if(hasEdit){
        var target=document.querySelector('.hpa-editing') || document.querySelector('.hpa-cancel-edit');
        if(target){
          var card=target.closest('.hpa-card') || target;
          setTimeout(function(){card.scrollIntoView({behavior:'smooth',block:'start'});},160);
        }
      }
    }catch(e){}
  });
})();

/* v3.9 stronger edit scroll and obligation anchors */
(function(){
  document.addEventListener('DOMContentLoaded',function(){
    try{
      var params=new URLSearchParams(window.location.search);
      var editKeys=['hpa_edit_account','hpa_edit_transaction','hpa_edit_asset','hpa_edit_category','hpa_edit_debt','hpa_edit_receivable','hpa_edit_loan','hpa_edit_check','hpa_edit_recurring'];
      var hasEdit=editKeys.some(function(k){return params.has(k);});
      if(hasEdit){
        setTimeout(function(){
          var card=document.querySelector('.hpa-card.hpa-editing') || (document.querySelector('.hpa-cancel-edit') ? document.querySelector('.hpa-cancel-edit').closest('.hpa-card') : null);
          if(card){
            var y=card.getBoundingClientRect().top + window.pageYOffset - 14;
            window.scrollTo({top:Math.max(0,y),behavior:'smooth'});
          }
        },260);
      }
      if(location.hash==='#hpa-future-obligations'){
        setTimeout(function(){
          var f=document.getElementById('hpa-future-obligations');
          if(f){window.scrollTo({top:Math.max(0,f.getBoundingClientRect().top+window.pageYOffset-14),behavior:'smooth'});}
        },220);
      }
    }catch(e){}
  });
})();


/* v3.10 final navigation/message cleanup and precise edit scroll */
(function(){
  document.addEventListener('DOMContentLoaded',function(){
    try{
      var current=new URL(window.location.href);
      if(current.searchParams.has('hpa_msg')){
        current.searchParams.delete('hpa_msg');
        window.history.replaceState({},'',current.pathname + (current.search ? current.search : '') + current.hash);
      }
      document.querySelectorAll('.hpa-desktop-nav a,.hpa-mobile-nav a').forEach(function(a){
        try{
          var u=new URL(a.href, window.location.origin);
          u.searchParams.delete('hpa_msg');
          a.href=u.toString();
        }catch(e){}
      });
    }catch(e){}
    try{
      var params=new URLSearchParams(window.location.search);
      var editKeys=['hpa_edit_account','hpa_edit_transaction','hpa_edit_asset','hpa_edit_category','hpa_edit_debt','hpa_edit_receivable','hpa_edit_loan','hpa_edit_check','hpa_edit_recurring'];
      var hasEdit=editKeys.some(function(k){return params.has(k);});
      if(hasEdit){
        setTimeout(function(){
          var card=document.querySelector('.hpa-card.hpa-editing') || (document.querySelector('.hpa-cancel-edit') ? document.querySelector('.hpa-cancel-edit').closest('.hpa-card') : null);
          if(card){
            var top=card.getBoundingClientRect().top + window.pageYOffset - 88;
            window.scrollTo({top:Math.max(0,top),behavior:'smooth'});
          }
        },720);
      }
    }catch(e){}
  });
})();


/* v3.12 premium UX enhancements - additive only */
(function(){
  function qs(s,root){return (root||document).querySelector(s)}
  function qsa(s,root){return Array.prototype.slice.call((root||document).querySelectorAll(s))}
  function isMobile(){return window.matchMedia('(max-width: 860px)').matches}
  function text(el){return (el&&el.textContent||'').trim()}
  function addTimeline(){
    var list=qs('#hpa-transactions-list'); if(!list||list.dataset.timelineReady) return; list.dataset.timelineReady='1';
    var last=''; qsa('.hpa-tx-list-card',list).forEach(function(card){
      var small=qs('summary small',card); var t=text(small); var date=(t.match(/[۰-۹0-9]{4}\/[۰-۹0-9]{2}\/[۰-۹0-9]{2}/)||[''])[0];
      if(date && date!==last){last=date; var d=document.createElement('div'); d.className='hpa-timeline-date'; d.textContent=date; list.insertBefore(d,card);}
    });
  }
  function addStickySummary(){
    var main=qs('.hpa-main'); if(!main||qs('.hpa-tab-sticky-summary',main)) return;
    var active=qs('.hpa-desktop-nav .is-active span:last-child')||qs('.hpa-mobile-nav .is-active span:last-child'); var title=text(active)||'داشبورد';
    if(title==='داشبورد') return;
    var count=qsa('.hpa-recent-tx-card,.hpa-asset-card,.hpa-obligation-card,.hpa-category-item,.hpa-ledger-card',main).length;
    var bar=document.createElement('div'); bar.className='hpa-tab-sticky-summary'; bar.innerHTML='<b>'+title+'</b><span>نمای سریع این بخش</span><em>'+count.toLocaleString('fa-IR')+' مورد</em>';
    var ref=qs('.hpa-tab-identity',main); if(ref&&ref.nextSibling) main.insertBefore(bar,ref.nextSibling);
  }
  function addFab(){
    return;
    if(!isMobile()||qs('.hpa-mobile-fab')) return;
    var href=''; var label='ثبت سریع'; var tab=new URL(location.href).searchParams.get('hpa_tab')||'dashboard';
    if(tab==='transactions'){href='#';label='ثبت تراکنش'} else if(tab==='assets'){href='#';label='ثبت دارایی'} else {href=(location.pathname+(location.search?location.search:'')).replace(/([?&])hpa_tab=[^&]*/,'$1hpa_tab=transactions'); if(href.indexOf('hpa_tab=transactions')<0) href+=(href.indexOf('?')>-1?'&':'?')+'hpa_tab=transactions'; label='ثبت تراکنش'}
    var a=document.createElement('a'); a.className='hpa-mobile-fab'; a.href=href; a.innerHTML='<span>＋</span>'+label; document.body.appendChild(a);
    a.addEventListener('click',function(e){
      var btn=qs('.hpa-mobile-wizard-launch,.hpa-asset-wizard-launch,.hpa-start-transaction-wizard,.hpa-start-asset-wizard');
      if(btn){e.preventDefault(); btn.scrollIntoView({behavior:'smooth',block:'center'}); setTimeout(function(){btn.click();},260);}
    });
  }
  function emptyStates(){
    qsa('.hpa-muted').forEach(function(el){
      var t=text(el); if(!/هنوز|ثبت نشده|وجود ندارد/.test(t)) return;
      if(el.closest('.hpa-empty-state')) return;
      el.classList.add('hpa-empty-state'); el.innerHTML='<b>'+t+'</b><small>از دکمه ثبت همین بخش برای شروع استفاده کن.</small>';
    });
  }
  function densityControl(){
    var app=qs('.hpa-app'); if(!app) return;
    var saved=localStorage.getItem('hpa_density')||'comfortable'; if(saved==='compact') app.classList.add('hpa-density-compact');
    var settings=qs('.hpa-tab-identity h1'); if(!settings||text(settings)!=='تنظیمات'||qs('.hpa-density-toggle')) return;
    var card=document.createElement('section'); card.className='hpa-card'; card.innerHTML='<h2>ظاهر و چیدمان</h2><div class="hpa-settings-control-center"><button type="button" data-hpa-density="comfortable"><b>حالت راحت</b><small>کارت‌ها بازتر و خواناتر</small></button><button type="button" data-hpa-density="compact"><b>حالت فشرده</b><small>مناسب موبایل و داده زیاد</small></button></div>';
    var main=qs('.hpa-main'); var after=qs('.hpa-tab-sticky-summary')||qs('.hpa-tab-identity'); if(after&&after.nextSibling) main.insertBefore(card,after.nextSibling);
    card.addEventListener('click',function(e){var b=e.target.closest('[data-hpa-density]'); if(!b)return; var v=b.getAttribute('data-hpa-density'); localStorage.setItem('hpa_density',v); app.classList.toggle('hpa-density-compact',v==='compact');});
  }
  function swipeCards(){
    if(!isMobile()) return;
    qsa('.hpa-recent-tx-card,.hpa-asset-card,.hpa-obligation-card').forEach(function(card){
      if(card.dataset.swipeReady) return; card.dataset.swipeReady='1'; var sx=0;
      card.addEventListener('touchstart',function(e){sx=e.touches[0].clientX;},{passive:true});
      card.addEventListener('touchend',function(e){var dx=(e.changedTouches[0].clientX-sx); if(Math.abs(dx)>55){card.classList.add('hpa-swipe-peek'); setTimeout(function(){card.classList.remove('hpa-swipe-peek');},650); var edit=card.querySelector('.hpa-edit'); if(edit && dx<0){ /* visual peek only */ }}},{passive:true});
    });
  }
  function storyReportCards(){
    var reports=qs('.hpa-tab-identity h1'); if(!reports||text(reports)!=='گزارش‌ها') return;
    qsa('.hpa-card h2,.hpa-card h3').forEach(function(h){
      var card=h.closest('.hpa-card'); if(!card||card.dataset.storyReady) return; card.dataset.storyReady='1';
      if(!qs('.hpa-story-note',card)){var p=document.createElement('p'); p.className='hpa-muted hpa-story-note'; p.textContent='این بخش برای تصمیم‌گیری سریع‌تر خلاصه شده و جزئیات با اسکرول در ادامه قابل بررسی است.'; h.insertAdjacentElement('afterend',p);}
    });
  }
  function enhanceCharts(){
    qsa('svg').forEach(function(svg){svg.setAttribute('role','img'); svg.style.maxWidth='100%'; svg.style.overflow='visible';});
  }
  document.addEventListener('DOMContentLoaded',function(){
    document.documentElement.classList.add('hpa-bottom-sheet-mobile');
    addTimeline(); addStickySummary(); addFab(); emptyStates(); densityControl(); swipeCards(); storyReportCards(); enhanceCharts();
  });
  document.addEventListener('toggle',function(e){ if(e.target.matches('details')){ e.target.classList.toggle('is-open',e.target.open); } },true);
})();

/* v3.12.1 targeted fixes: FAB reliability + mobile wizard category icons */
(function(){
  function qs(s,r){return (r||document).querySelector(s)}
  function qsa(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))}
  function isMobile(){return window.matchMedia('(max-width:860px)').matches}
  function fire(el){ if(!el) return; el.dispatchEvent(new Event('change',{bubbles:true})); }
  function normalizeWizardButtons(){
    qsa('.hpa-wizard-options .hpa-wizard-option').forEach(function(b){
      var t=(b.textContent||'').trim();
      if(!t) return;
      b.textContent=t.replace(/\s+/g,' ');
      if(!/[\u{1F300}-\u{1FAFF}]/u.test(t) && /موضوع|بدون دسته|بدون موضوع/.test((qs('.hpa-wizard-body h3')||{}).textContent||'')){
        b.textContent='🏷️ '+t;
      }
    });
  }
  function fixFab(){
    var fab=qs('.hpa-mobile-fab'); if(!fab || fab.dataset.hpaFixed312) return; fab.dataset.hpaFixed312='1';
    fab.addEventListener('click',function(e){
      var tab=new URL(location.href).searchParams.get('hpa_tab')||'dashboard';
      var btn=null;
      if(tab==='assets') btn=qs('.hpa-mobile-asset-wizard-launch,.hpa-start-asset-wizard');
      else btn=qs('.hpa-mobile-wizard-launch,.hpa-start-transaction-wizard');
      if(btn){e.preventDefault(); btn.scrollIntoView({behavior:'smooth',block:'center'}); setTimeout(function(){btn.click();},180);}
    },true);
  }
  function preventHorizontalLeak(){
    if(!isMobile()) return;
    qsa('.hpa-card,.hpa-recent-tx-card,.hpa-asset-card,.hpa-debt-like-card,.hpa-obligation-card,.hpa-kpi,.hpa-tab-identity').forEach(function(el){
      el.style.maxWidth='100%'; el.style.minWidth='0';
    });
  }
  document.addEventListener('click',function(e){
    if(e.target && e.target.closest && e.target.closest('.hpa-wizard-option')) setTimeout(normalizeWizardButtons,30);
  },true);
  document.addEventListener('DOMContentLoaded',function(){fixFab(); normalizeWizardButtons(); preventHorizontalLeak(); setTimeout(function(){fixFab(); normalizeWizardButtons(); preventHorizontalLeak();},500);});
  window.addEventListener('resize',preventHorizontalLeak);
})();


/* v3.12.7 authoritative fixes: recurring occurrence linkage + transfers without category */
(function(){
  function q(sel,root){return (root||document).querySelector(sel)}
  function qa(sel,root){return Array.prototype.slice.call((root||document).querySelectorAll(sel))}
  function transactionForm(el){
    var f=el&&el.closest?el.closest('form'):null;
    if(f&&q('select[name="type"]',f)) return f;
    var marker=q('input[name="action"][value="hpa_save_transaction"],input[name="hpa_action"][value="hpa_save_transaction"]');
    return marker?marker.closest('form'):null;
  }
  function syncRecurring(form){
    if(!form)return;
    var type=q('select[name="type"]',form), rec=q('select[name="recurring_id"]',form), due=q('select[name="recurring_due_jalali_date"]',form), hidden=q('input[name="recurring_due_recurring_id"]',form);
    if(!type||type.value!=='recurring_debt')return;
    var rid=rec&&rec.value&&rec.value!=='0'?rec.value:'';
    if(due&&due.selectedOptions&&due.selectedOptions[0]){
      var fromDue=due.selectedOptions[0].getAttribute('data-recurring')||'';
      if(fromDue){rid=fromDue;if(rec)rec.value=fromDue;}
    }
    if(hidden)hidden.value=rid;
  }
  function enforceNoCategoryForTransfers(form){
    if(!form)return;
    var type=q('select[name="type"]',form); if(!type)return;
    var isTransfer=type.value==='transfer'||type.value==='person_transfer';
    var cat=q('select[name="category_id"]',form);
    qa('.hpa-category-field',form).forEach(function(l){l.style.setProperty('display',isTransfer?'none':'grid','important');});
    if(cat){
      cat.required=false;cat.removeAttribute('required');
      if(isTransfer){cat.value='0';cat.disabled=true;}else{cat.disabled=false;}
    }
    var split=q('input[name="hpa_split_categories"]',form);
    if(split&&isTransfer){split.checked=false;split.disabled=true;}else if(split){split.disabled=false;}
    qa('.hpa-split-toggle-field,.hpa-split-field',form).forEach(function(l){
      if(isTransfer){l.style.setProperty('display','none','important');qa('input,select',l).forEach(function(x){x.disabled=true;});}
      else{qa('input,select',l).forEach(function(x){x.disabled=false;});}
    });
  }
  function syncAll(form){enforceNoCategoryForTransfers(form);syncRecurring(form)}
  document.addEventListener('DOMContentLoaded',function(){qa('form').forEach(syncAll);setTimeout(function(){qa('form').forEach(syncAll)},350);});
  document.addEventListener('change',function(e){
    if(!e.target||!e.target.matches)return;
    if(e.target.matches('select[name="type"],select[name="recurring_id"],select[name="recurring_due_jalali_date"]')){
      var f=transactionForm(e.target);setTimeout(function(){syncAll(f)},0);
    }
  },true);
  document.addEventListener('submit',function(e){
    var f=transactionForm(e.target);if(!f||f!==e.target)return;
    syncAll(f);
    var type=q('select[name="type"]',f);
    if(type&&(type.value==='transfer'||type.value==='person_transfer')){
      var cat=q('select[name="category_id"]',f);if(cat){cat.disabled=false;cat.value='0';cat.required=false;}
      var split=q('input[name="hpa_split_categories"]',f);if(split){split.checked=false;split.disabled=true;}
    }
  },true);
})();

/* v3.12.8 - Hide Amount checkbox visual feedback */
(function(){
  document.addEventListener('DOMContentLoaded', function(){
    var cb = document.querySelector('input[name="hide_amount"]');
    if (!cb) return;
    function update(){
      var lbl = cb.closest('label');
      if (!lbl) return;
      lbl.style.background = cb.checked ? 'linear-gradient(135deg,#fef3c7,#fde68a)' : '';
      lbl.style.border = cb.checked ? '1px solid #f59e0b' : '';
      lbl.style.borderRadius = cb.checked ? '16px' : '';
      lbl.style.padding = cb.checked ? '10px 12px' : '';
    }
    cb.addEventListener('change', update);
    update();
  });
})();

/* ===== v3.12.9 — New Features ===== */

/* PIN input — prevent browser autofill from injecting saved passwords */
(function(){
  document.addEventListener('DOMContentLoaded', function(){
    var pinInput = document.querySelector('.hpa-pin-card input[name="hpa_pin"]');
    if (!pinInput) return;
    // برای مرورگرهایی که autocomplete="off" را نادیده می‌گیرند
    pinInput.setAttribute('autocomplete', 'off');
    pinInput.setAttribute('data-form-type', 'other');
    pinInput.setAttribute('data-lpignore', 'true');
    pinInput.setAttribute('data-1p-ignore', '1');
    // فوکوس کوتاه روی یک فیلد مخفی برای فریب autofill
    var dummy = document.createElement('input');
    dummy.setAttribute('type', 'password');
    dummy.setAttribute('style', 'position:absolute;width:0;height:0;opacity:0;pointer-events:none');
    dummy.setAttribute('tabindex', '-1');
    pinInput.parentNode.insertBefore(dummy, pinInput);
    setTimeout(function(){ dummy.remove(); }, 300);
  });
})();

/* Hide amount *** — same visual weight as normal amount */
(function(){
  document.addEventListener('DOMContentLoaded', function(){
    // اطمینان از اینکه *** با سایز فونت مناسب نمایش داده می‌شه
    document.querySelectorAll('.hpa-amount-hidden').forEach(function(el){
      var parent = el.closest('.hpa-recent-main');
      if (parent) {
        var sibling = parent.querySelector('b');
        if (!sibling) {
          el.style.fontSize = '16px';
          el.style.fontWeight = '900';
        }
      }
    });
  });
})();

/* ===== v3.13 — multi-tags, per-item prices, journal show-more ===== */
(function(){
  function faToEn(s){return String(s||'').replace(/[۰-۹٠-٩]/g,function(d){return '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'.indexOf(d)%10;});}
  function num(v){var n=parseFloat(faToEn(String(v||'')).replace(/[,\s٬]/g,''));return isNaN(n)?0:n;}
  function grp(n){n=Math.round(n);var s=String(n),o='',c=0;for(var i=s.length-1;i>=0;i--){o=s[i]+o;if(++c%3===0&&i>0)o='٬'+o;}return o.replace(/[0-9]/g,function(d){return '۰۱۲۳۴۵۶۷۸۹'[d];});}

  /* ---- multi-tag chip input ---- */
  function initTags(input){
    if(!input||input.dataset.tagsReady) return; input.dataset.tagsReady='1';
    var wrap=document.createElement('div'); wrap.className='hpa-tagbox';
    var chips=document.createElement('div'); chips.className='hpa-tag-chips';
    var field=document.createElement('input'); field.type='text'; field.className='hpa-tag-entry'; field.placeholder=input.getAttribute('placeholder')||'برچسب و Enter';
    field.setAttribute('autocomplete','off');
    wrap.appendChild(chips); wrap.appendChild(field);
    input.type='hidden';
    input.parentNode.insertBefore(wrap, input.nextSibling);
    function tags(){ return input.value.split(',').map(function(t){return t.trim();}).filter(Boolean); }
    function save(list){ input.value=list.join(','); }
    function render(){
      chips.innerHTML='';
      tags().forEach(function(t,i){
        var c=document.createElement('span'); c.className='hpa-tag-chip'; c.innerHTML='<b>#'+t.replace(/</g,'&lt;')+'</b><button type="button" aria-label="حذف">×</button>';
        c.querySelector('button').onclick=function(){ var l=tags(); l.splice(i,1); save(l); render(); };
        chips.appendChild(c);
      });
    }
    function add(){ var v=field.value.trim().replace(/^#/,''); if(!v) return; var l=tags(); if(l.indexOf(v)<0){ l.push(v); save(l); render(); } field.value=''; }
    field.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===','){ e.preventDefault(); add(); } else if(e.key==='Backspace' && !field.value){ var l=tags(); l.pop(); save(l); render(); } });
    field.addEventListener('blur',add);
    render();
  }

  /* ---- per-item price editor (name + price rows) ---- */
  function initItems(box, hidden){
    if(!box||box.dataset.itemsReady) return; box.dataset.itemsReady='1';
    hidden=hidden||box.parentNode.querySelector('input[name="hpa_items"]');
    var rows=document.createElement('div'); rows.className='hpa-item-rows';
    var addRow=document.createElement('div'); addRow.className='hpa-item-add';
    var nName=document.createElement('input'); nName.type='text'; nName.className='hpa-item-name'; nName.placeholder='نام قلم (مثلاً شیر)'; nName.setAttribute('autocomplete','off');
    var nAmt=document.createElement('input'); nAmt.type='text'; nAmt.className='hpa-item-amt'; nAmt.placeholder='قیمت'; nAmt.setAttribute('inputmode','decimal');
    var nBtn=document.createElement('button'); nBtn.type='button'; nBtn.className='hpa-btn hpa-btn-ghost hpa-item-addbtn'; nBtn.textContent='افزودن قلم';
    addRow.appendChild(nName); addRow.appendChild(nAmt); addRow.appendChild(nBtn);
    box.appendChild(rows); box.appendChild(addRow);
    var data=[]; try{ data=JSON.parse(box.getAttribute('data-items')||'[]')||[]; }catch(e){ data=[]; }
    function sync(){ hidden.value=JSON.stringify(data.filter(function(x){return x.name && num(x.amount)>0;})); render(); }
    function render(){
      rows.innerHTML='';
      var total=0;
      data.forEach(function(it,i){
        total+=num(it.amount);
        var r=document.createElement('div'); r.className='hpa-item-row';
        r.innerHTML='<span class="hpa-item-row-name"></span><span class="hpa-item-row-amt">'+grp(num(it.amount))+'</span><button type="button" class="hpa-item-del" aria-label="حذف">×</button>';
        r.querySelector('.hpa-item-row-name').textContent=it.name;
        r.querySelector('.hpa-item-del').onclick=function(){ data.splice(i,1); sync(); };
        rows.appendChild(r);
      });
      if(data.length){ var t=document.createElement('div'); t.className='hpa-item-total'; t.innerHTML='<span>جمع اقلام</span><b>'+grp(total)+'</b>'; rows.appendChild(t); }
    }
    function add(){ var n=nName.value.trim(); var a=num(nAmt.value); if(!n||a<=0){ nName.focus(); return; } data.push({name:n,amount:a}); nName.value=''; nAmt.value=''; sync(); nName.focus(); }
    nBtn.onclick=add;
    nName.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); nAmt.focus(); } });
    nAmt.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); add(); } });
    render();
  }
  window.hpaInitItems=initItems;
  window.hpaInitTags=initTags;

  /* ---- journal show-more ---- */
  function initJournalMore(){
    document.querySelectorAll('.hpa-journal-more').forEach(function(btn){
      if(btn.dataset.ready) return; btn.dataset.ready='1';
      btn.addEventListener('click',function(){
        var box=btn.closest('.hpa-journal-collapsed'); if(box){ box.classList.remove('hpa-journal-collapsed'); btn.style.display='none'; }
      });
    });
  }

  function initAll(root){
    (root||document).querySelectorAll('.hpa-tags-input').forEach(initTags);
    (root||document).querySelectorAll('.hpa-items-editor').forEach(function(b){ initItems(b); });
    initJournalMore();
  }
  document.addEventListener('DOMContentLoaded',function(){ initAll(document); });
})();
