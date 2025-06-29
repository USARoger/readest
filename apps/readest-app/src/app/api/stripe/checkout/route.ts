import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/libs/stripe/server';
import { validateUserAndToken } from '@/utils/access';
import { supabase } from '@/utils/supabase';

export async function POST(request: NextRequest) {
  const { priceId, metadata = {} } = await request.json();

  const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
  if (!user || !token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 403 });
  }

  const enhancedMetadata = {
    ...metadata,
    userId: user.id,
  };

  try {
    const { data: customerData } = await supabase
      .from('customers')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single();

    let customerId;
    if (!customerData?.stripe_customer_id) {
      const stripe = getStripe();
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          userId: user.id,
        },
      });
      customerId = customer.id;
      await supabase.from('customers').insert({
        user_id: user.id,
        stripe_customer_id: customerId,
      });
    } else {
      customerId = customerData.stripe_customer_id;
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      metadata: enhancedMetadata,
      success_url: `${request.headers.get('origin')}/user/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${request.headers.get('origin')}/user`,
    });

    return NextResponse.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Error creating checkout session' }, { status: 500 });
  }
}
