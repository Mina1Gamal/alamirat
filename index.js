/**
 * Cloud Functions — Secure order processing & inventory.
 * Admin auth via Firestore 'admins' collection.
 * Deploy: firebase deploy --only functions
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

// ============================================================
// HELPERS
// ============================================================
function assert(condition, code, message) {
  if (!condition) throw new HttpsError(code, message);
}

function isValidPhone(phone) {
  return /^01[0125][0-9]{8}$/.test(String(phone).trim());
}

const STATUSES = ["new", "confirmed", "preparing", "shipped", "delivered", "cancelled"];

// ✅ التحقق من الأدمن عبر Firestore
async function assertAdmin(auth) {
  if (!auth || !auth.uid) {
    throw new HttpsError("unauthenticated", "يجب تسجيل الدخول");
  }
  const adminSnap = await db.collection("admins").doc(auth.uid).get();
  if (!adminSnap.exists || adminSnap.data().active !== true) {
    throw new HttpsError("permission-denied", "غير مصرح — مسؤول فقط");
  }
}

// ============================================================
// 1) CREATE ORDER (public callable)
// ============================================================
exports.createOrder = onCall({ region: "us-central1", cors: true }, async (request) => {
  const d = request.data || {};

  // --- Validate inputs ---
  assert(d.customerName && d.customerName.trim().length >= 3,
    "invalid-argument", "الاسم الكامل مطلوب");
  assert(isValidPhone(d.phone),
    "invalid-argument", "رقم الموبايل غير صحيح");
  if (d.alternativePhone) {
    assert(isValidPhone(d.alternativePhone),
      "invalid-argument", "رقم الهاتف البديل غير صحيح");
  }
  assert(d.governorate && d.governorate.trim().length > 0,
    "invalid-argument", "المحافظة مطلوبة");
  assert(d.city && d.city.trim().length > 0,
    "invalid-argument", "المدينة مطلوبة");
  assert(d.address && d.address.trim().length >= 10,
    "invalid-argument", "العنوان التفصيلي مطلوب");
  assert(Array.isArray(d.items) && d.items.length > 0,
    "invalid-argument", "لا توجد منتجات في الطلب");
  assert(d.clientToken && typeof d.clientToken === "string",
    "invalid-argument", "رمز الطلب مفقود");

  // --- Duplicate token check ---
  const tokenRef = db.collection("orderTokens").doc(d.clientToken);
  const tokenSnap = await tokenRef.get();
  if (tokenSnap.exists) {
    const usedAt = tokenSnap.data().usedAt?.toDate?.() || new Date(0);
    if (Date.now() - usedAt.getTime() < 5 * 60 * 1000) {
      throw new HttpsError("already-exists", "تم إرسال هذا الطلب بالفعل");
    }
  }

  // --- Transaction ---
  const orderRef = db.collection("orders").doc();
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const orderNumber = "ORD-" + dateStr + "-" + String(Date.now()).slice(-5);

  let subtotal = 0;
  const validatedItems = [];
  let finalTotal = 0;

  await db.runTransaction(async (tx) => {
    for (const item of d.items) {
      assert(item.productId && item.size && item.color,
        "invalid-argument", "بيانات المنتج غير مكتملة");
      const qty = Number(item.quantity);
      assert(Number.isInteger(qty) && qty > 0,
        "invalid-argument", "الكمية يجب أن تكون رقماً صحيحاً موجباً");

      const pRef = db.collection("products").doc(item.productId);
      const pSnap = await tx.get(pRef);
      assert(pSnap.exists, "not-found", "المنتج غير موجود");

      const p = pSnap.data();
      assert(p.status === "active", "failed-precondition", `المنتج "${p.name}" غير متاح`);

      const vIndex = p.variants.findIndex(
        v => v.size === item.size && v.color === item.color
      );
      assert(vIndex !== -1, "not-found",
        `المقاس "${item.size}" واللون "${item.color}" غير متوفرين`);

      const variant = p.variants[vIndex];
      assert(variant.stock >= qty, "failed-precondition",
        `الكمية غير متوفرة من "${p.name}" (المتاح: ${variant.stock})`);

      const newVariants = [...p.variants];
      newVariants[vIndex] = { ...variant, stock: variant.stock - qty };
      tx.update(pRef, {
        variants: newVariants,
        totalStock: newVariants.reduce((s, v) => s + v.stock, 0),
        updatedAt: FieldValue.serverTimestamp()
      });

      const unitPrice = (p.discountPrice != null && p.discountPrice > 0 && p.discountPrice < p.price)
        ? Number(p.discountPrice) : Number(p.price);
      const lineSubtotal = unitPrice * qty;
      subtotal += lineSubtotal;

      validatedItems.push({
        productId: item.productId,
        productName: p.name,
        productImage: (p.images && p.images[0]) || "",
        size: item.size,
        color: item.color,
        quantity: qty,
        unitPrice,
        subtotal: lineSubtotal
      });
    }

    // Shipping
    const sSnap = await tx.get(db.doc("settings/shipping"));
    let shippingFee = 50;
    let freeThreshold = 1500;
    if (sSnap.exists) {
      shippingFee = Number(sSnap.data().shippingFee) || 0;
      freeThreshold = Number(sSnap.data().freeShippingThreshold) || 0;
    }
    if (freeThreshold > 0 && subtotal >= freeThreshold) shippingFee = 0;
    finalTotal = subtotal + shippingFee;

    tx.set(orderRef, {
      orderId: orderRef.id,
      orderNumber,
      customerName: d.customerName.trim(),
      phone: d.phone.trim(),
      alternativePhone: (d.alternativePhone || "").trim(),
      governorate: d.governorate.trim(),
      city: d.city.trim(),
      address: d.address.trim(),
      notes: (d.notes || "").trim(),
      items: validatedItems,
      subtotal,
      shippingFee,
      total: finalTotal,
      paymentMethod: "cod",
      status: "new",
      stockDeducted: true,
      adminNotes: "",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    tx.set(tokenRef, {
      usedAt: FieldValue.serverTimestamp(),
      orderId: orderRef.id
    });
  });

  return {
    success: true,
    orderId: orderRef.id,
    orderNumber,
    total: finalTotal
  };
});

// ============================================================
// 2) UPDATE ORDER STATUS (admin only — Firestore check)
// ============================================================
exports.updateOrderStatus = onCall({ region: "us-central1" }, async (request) => {
  await assertAdmin(request.auth);

  const { orderId, newStatus, adminNotes } = request.data || {};
  assert(orderId, "invalid-argument", "معرف الطلب مطلوب");
  assert(STATUSES.includes(newStatus), "invalid-argument", "حالة غير صالحة");

  const orderRef = db.collection("orders").doc(orderId);

  await db.runTransaction(async (tx) => {
    const oSnap = await tx.get(orderRef);
    assert(oSnap.exists, "not-found", "الطلب غير موجود");
    const order = oSnap.data();

    assert(order.status !== newStatus, "failed-precondition", "الطلب بالفعل في هذه الحالة");
    assert(order.status !== "delivered", "failed-precondition", "لا يمكن تعديل طلب تم توصيله");

    if (newStatus === "cancelled" && order.stockDeducted === true) {
      for (const item of order.items) {
        const pRef = db.collection("products").doc(item.productId);
        const pSnap = await tx.get(pRef);
        if (!pSnap.exists) continue;
        const p = pSnap.data();
        const vIndex = p.variants.findIndex(
          v => v.size === item.size && v.color === item.color
        );
        if (vIndex === -1) continue;
        const newVariants = [...p.variants];
        newVariants[vIndex] = {
          ...newVariants[vIndex],
          stock: newVariants[vIndex].stock + item.quantity
        };
        tx.update(pRef, {
          variants: newVariants,
          totalStock: newVariants.reduce((s, v) => s + v.stock, 0),
          updatedAt: FieldValue.serverTimestamp()
        });
      }
      tx.update(orderRef, {
        status: "cancelled",
        stockDeducted: false,
        adminNotes: adminNotes ?? order.adminNotes ?? "",
        updatedAt: FieldValue.serverTimestamp()
      });
      return;
    }

    tx.update(orderRef, {
      status: newStatus,
      adminNotes: adminNotes ?? order.adminNotes ?? "",
      updatedAt: FieldValue.serverTimestamp()
    });
  });

  return { success: true, orderId, newStatus };
});