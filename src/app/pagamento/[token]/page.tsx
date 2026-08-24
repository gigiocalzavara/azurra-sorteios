import {PaymentClient} from "./payment-client";
export default async function PaymentPage({params}:{params:Promise<{token:string}>}){const {token}=await params;return <PaymentClient token={token}/>}
