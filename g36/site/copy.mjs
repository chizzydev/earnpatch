// Product vocabulary. Identity, accounting and authorization remain in their existing modules.
export const demo={title:'Interactive demo',description:'Explore the complete workflow with sample accounts and simulated payments. File processing is real.'};
export const operationNames={register:'Software added',commission:'Commission created',accept:'Commission accepted',submit:'Delivery submitted',approve:'Release approved',pause:'Availability updated',purchase:'Access purchased',consume:'Report processed',withdraw:'Earnings withdrawn',create_product:'Software registration',fund_storage:'Storage funding',open_opportunity:'Commission',set_paused:'Availability change',consume_use:'Access used'};
export const operationName=method=>operationNames[method]||String(method).replaceAll('_',' ');
export const stageCopy={
 open:{label:'Developer invited',description:'Maya can review the brief and accept the agreement.',next:'Developer accepts'},
 accepted:{label:'In development',description:'The developer is preparing a release for the merchant to review.',next:'Developer delivers'},
 submitted:{label:'Awaiting review',description:'The delivery is ready for the merchant’s approval.',next:'Merchant reviews'},
 live:{label:'Published',description:'Customers can purchase access and use the approved release.',next:'Available to customers'},
 paused:{label:'Sales paused',description:'The merchant must resume availability before purchases or use.',next:'Merchant resumes'}
};
export const proofCopy={
 fund_storage:['Product records funded','The merchant backed the storage needed for agreements and customer records.'],
 open_opportunity:['Upgrade commissioned','The merchant nominated a developer and set the price, revenue share and cap.'],
 accept:['Agreement accepted','The developer accepted the exact commercial terms.'],
 submit:['Delivery submitted','The developer recorded the identity of the delivered SafeShare release.'],
 approve:['Release approved','The merchant approved that release and made it available for purchase.'],
 purchase:['Access purchased','The customer paid 0.01 testNEAR. The agreement allocated 0.008 to the merchant and 0.002 to the developer.'],
 consume_use:['Report processed','The customer used their access and received a genuinely sanitized CSV.'],
 withdraw:['Royalty paid','The developer received 0.002 testNEAR. The native transfer and settlement callback were independently confirmed.']
};
